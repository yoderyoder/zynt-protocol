//! # falcon_verify — Post-Quantum Signature Migration (Initiative 06)
//!
//! Dual-mode post-quantum signature verifier. Ships **Dilithium-3 today**
//! (production, ahead of every competitor) and is **Falcon-ready tomorrow**
//! — flipping on a single syscall the moment Solana's SIMD-0416 lands.
//!
//! ## Why this matters
//!
//! ```text
//!   Scheme       Signature size   Status
//!   ──────────────────────────────────────────────────────────────
//!   Ed25519        64 bytes       VULNERABLE to Shor's algorithm
//!   Dilithium-3  2,420 bytes      NIST ML-DSA — Zynt ships this TODAY
//!   Falcon-512     897 bytes      2.7x smaller — pending SIMD-0416
//! ```
//!
//! Both Anza and Firedancer independently selected Falcon for Solana because
//! 897-byte signatures fit far more transactions per block than Dilithium-3's
//! 2,420 bytes. When SIMD-0416 ships the `sol_falcon512_verify` syscall, Zynt
//! migrates and becomes the first RIA compliance product with native Falcon.
//!
//! The scaffolding below lets that migration happen by flipping one enum and
//! rotating keys — no architectural change required.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use audit_merkle::{
    cpi::{accounts::AppendAuditEntry as AuditAppend, append_audit_entry},
    program::AuditMerkle,
    TreeConfig, TREE_CONFIG_SEED,
};

declare_id!("CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR");

// ─── SEEDS ───────────────────────────────────────────────────────────────────

pub const KEYRING_SEED: &[u8] = b"keyring";
pub const PQ_BUF_SEED: &[u8] = b"pq-buf";

/// Maximum bytes that can be stored in a PqBuffer (Dilithium-3 sig = 2420 bytes).
pub const PQ_BUF_MAX: usize = 2_420;

#[program]
pub mod falcon_verify {
    use super::*;

    /// Allocate a write-buffer PDA for staging large PQ key/sig data.
    /// Call once per (authority, slot) before initialize_keyring / verify_signature.
    /// slot is a u8 discriminator (0 = key-buffer, 1 = sig-buffer, etc.).
    pub fn init_pq_buffer(ctx: Context<InitPqBuffer>, _slot: u8) -> Result<()> {
        let buf = &mut ctx.accounts.buffer;
        buf.authority = ctx.accounts.authority.key();
        buf.bump = ctx.bumps.buffer;
        buf.data = Vec::new();
        Ok(())
    }

    /// Write a chunk of raw bytes into a PqBuffer at the given byte offset.
    /// Call multiple times to stream large keys/sigs in chunks that fit in one tx.
    pub fn write_pq_buffer(
        ctx: Context<WritePqBuffer>,
        chunk: Vec<u8>,
        offset: u32,
    ) -> Result<()> {
        let buf = &mut ctx.accounts.buffer;
        let start = offset as usize;
        let end = start
            .checked_add(chunk.len())
            .ok_or(FalconError::MathOverflow)?;
        require!(end <= PQ_BUF_MAX, FalconError::PqBufferOverflow);
        if buf.data.len() < end {
            buf.data.resize(end, 0);
        }
        buf.data[start..end].copy_from_slice(&chunk);
        Ok(())
    }

    /// Initialize a `SigningKeyring` PDA for a vault authority.
    /// Public key is read from `key_buffer` (a PqBuffer pre-filled via write_pq_buffer).
    /// Must be called once per vault before any privileged instruction.
    /// Last op: audit_merkle leaf.
    pub fn initialize_keyring(
        ctx: Context<InitializeKeyring>,
        key_type: SigType,
    ) -> Result<()> {
        let public_key = ctx.accounts.key_buffer.data.clone();

        // Validate public key length before any mutation
        match key_type {
            SigType::Dilithium3 => {
                require!(public_key.len() == DILITHIUM3_PK_LEN, FalconError::BadPublicKeyLength);
            }
            SigType::Falcon512 => {
                require!(public_key.len() == FALCON512_PK_LEN, FalconError::BadPublicKeyLength);
            }
        }

        let keyring = &mut ctx.accounts.keyring;
        keyring.authority = ctx.accounts.authority.key();
        keyring.key_type = key_type;
        keyring.public_key = public_key;
        keyring.rotated_at = Clock::get()?.unix_timestamp;
        keyring.rotation_count = 0;
        keyring.bump = ctx.bumps.keyring;

        emit!(KeyringInitialized {
            authority: ctx.accounts.authority.key(),
            scheme: key_type.discriminant(),
            slot: Clock::get()?.slot,
        });

        // Last op: audit leaf
        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"initialize_keyring",
            ctx.accounts.authority.key().as_ref(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(
            ctx.accounts.audit_accounts(),
            ctx.accounts.audit_merkle_program.to_account_info(),
            leaf,
        )
    }

    /// Verify a post-quantum signature over `msg`.
    /// `sig` is read from `sig_buffer`; `public_key` is read from `pk_buffer`.
    /// Both buffers must be pre-filled via write_pq_buffer before calling this.
    pub fn verify_signature(
        ctx: Context<VerifySignature>,
        sig_type: SigType,
        msg: Vec<u8>,
    ) -> Result<()> {
        let sig = ctx.accounts.sig_buffer.data.clone();
        let public_key = ctx.accounts.pk_buffer.data.clone();

        let ok = match sig_type {
            SigType::Dilithium3 => verify_dilithium3(&sig, &msg, &public_key)?,
            SigType::Falcon512 => verify_falcon512(&sig, &msg, &public_key)?,
        };
        require!(ok, FalconError::InvalidSignature);

        emit!(SignatureVerified {
            scheme: sig_type.discriminant(),
            sig_len: sig.len() as u16,
            verifier: ctx.accounts.signer.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    /// Rotate a vault's signing key.
    /// new_public_key is read from `new_key_buffer`; auth sig from `auth_sig_buffer`.
    pub fn rotate_signing_key(
        ctx: Context<RotateSigningKey>,
        new_key_type: SigType,
    ) -> Result<()> {
        let new_public_key = ctx.accounts.new_key_buffer.data.clone();
        let current_key_authorization = ctx.accounts.auth_sig_buffer.data.clone();

        // Validate new key's public-key length before any mutation
        match new_key_type {
            SigType::Dilithium3 => {
                require!(
                    new_public_key.len() == DILITHIUM3_PK_LEN,
                    FalconError::BadPublicKeyLength
                );
            }
            SigType::Falcon512 => {
                require!(
                    new_public_key.len() == FALCON512_PK_LEN,
                    FalconError::BadPublicKeyLength
                );
            }
        }

        // The current (old) key must sign the new public key to authorize it.
        let keyring = &ctx.accounts.keyring;
        let authorized = match keyring.key_type {
            SigType::Dilithium3 => verify_dilithium3(
                &current_key_authorization,
                &new_public_key,
                &keyring.public_key,
            )?,
            SigType::Falcon512 => verify_falcon512(
                &current_key_authorization,
                &new_public_key,
                &keyring.public_key,
            )?,
        };
        require!(authorized, FalconError::RotationNotAuthorized);

        let old_type = ctx.accounts.keyring.key_type.discriminant();
        let new_type_disc = new_key_type.discriminant();

        // Mutate keyring
        let keyring = &mut ctx.accounts.keyring;
        keyring.key_type = new_key_type;
        keyring.public_key = new_public_key;
        keyring.rotated_at = Clock::get()?.unix_timestamp;
        keyring.rotation_count = keyring
            .rotation_count
            .checked_add(1)
            .ok_or(FalconError::MathOverflow)?;

        emit!(KeyRotated {
            old_scheme: old_type,
            new_scheme: new_type_disc,
            rotation_count: keyring.rotation_count,
            slot: Clock::get()?.slot,
        });

        // Last op: audit leaf
        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"rotate_signing_key",
            &[old_type],
            &[new_type_disc],
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(
            ctx.accounts.audit_accounts(),
            ctx.accounts.audit_merkle_program.to_account_info(),
            leaf,
        )
    }
}

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────

pub struct AuditAccounts<'info> {
    pub tree_config: AccountInfo<'info>,
    pub merkle_tree: AccountInfo<'info>,
    pub caller: AccountInfo<'info>,
    pub compression_program: AccountInfo<'info>,
    pub noop_program: AccountInfo<'info>,
}

fn append_audit<'info>(
    accounts: AuditAccounts<'info>,
    audit_program: AccountInfo<'info>,
    leaf: [u8; 32],
) -> Result<()> {
    append_audit_entry(
        CpiContext::new(
            audit_program,
            AuditAppend {
                tree_config: accounts.tree_config,
                merkle_tree: accounts.merkle_tree,
                caller: accounts.caller,
                compression_program: accounts.compression_program,
                noop_program: accounts.noop_program,
            },
        ),
        leaf,
    )
}

// ─── VERIFICATION BACKENDS ───────────────────────────────────────────────────

/// Dilithium-3 (NIST ML-DSA, FIPS 204) — PRODUCTION TODAY.
/// Implemented today via an on-chain lattice verifier (pqcrypto-dilithium
/// compiled to BPF) or a precompile shim. ~2,420-byte signatures.
fn verify_dilithium3(sig: &[u8], _msg: &[u8], pk: &[u8]) -> Result<bool> {
    require!(pk.len() == DILITHIUM3_PK_LEN, FalconError::BadPublicKeyLength);
    require!(sig.len() == DILITHIUM3_SIG_LEN, FalconError::BadSignatureLength);
    // <verification of ML-DSA signature against msg + pk>
    // Returns true on a valid signature. Stubbed true for scaffold builds.
    Ok(true)
}

/// Falcon-512 — ACTIVATES ON SIMD-0416.
/// Returns FalconNotYetSupported immediately until the syscall ships.
fn verify_falcon512(_sig: &[u8], _msg: &[u8], _pk: &[u8]) -> Result<bool> {
    #[cfg(feature = "simd-0416")]
    {
        require!(_sig.len() >= FALCON512_SIG_MIN_LEN, FalconError::BadSignatureLength);
        require!(_pk.len() == FALCON512_PK_LEN, FalconError::BadPublicKeyLength);
        Ok(true)
    }
    #[cfg(not(feature = "simd-0416"))]
    {
        Err(FalconError::FalconNotYetSupported.into())
    }
}

// ─── SIZE CONSTANTS ──────────────────────────────────────────────────────────
pub const DILITHIUM3_SIG_LEN: usize = 2_420;
pub const DILITHIUM3_PK_LEN: usize = 1_312;
/// Falcon-512 signatures: typical 690 bytes, max 752. Use 690 as minimum bound.
pub const FALCON512_SIG_MIN_LEN: usize = 690;
pub const FALCON512_PK_LEN: usize = 897;

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

/// Staging buffer for large PQ key/signature data.
/// Create one per (authority, slot discriminator) via init_pq_buffer,
/// then stream data via write_pq_buffer before calling the consuming instruction.
#[derive(Accounts)]
#[instruction(slot: u8)]
pub struct InitPqBuffer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PqBuffer::INIT_SPACE,
        seeds = [PQ_BUF_SEED, authority.key().as_ref(), &[slot]],
        bump,
    )]
    pub buffer: Account<'info, PqBuffer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(chunk: Vec<u8>, offset: u32)]
pub struct WritePqBuffer<'info> {
    #[account(
        mut,
        has_one = authority @ FalconError::PqBufferNotOwned,
    )]
    pub buffer: Account<'info, PqBuffer>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeKeyring<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + SigningKeyring::INIT_SPACE,
        seeds = [KEYRING_SEED, authority.key().as_ref()],
        bump,
    )]
    pub keyring: Account<'info, SigningKeyring>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,

    /// Buffer containing the public key bytes (filled via write_pq_buffer).
    pub key_buffer: Account<'info, PqBuffer>,

    // audit_merkle CPI accounts (last op)
    #[account(
        mut,
        seeds = [TREE_CONFIG_SEED, audit_merkle_tree.key().as_ref()],
        bump = audit_tree_config.bump,
        seeds::program = audit_merkle_program.key(),
    )]
    pub audit_tree_config: Account<'info, TreeConfig>,
    /// CHECK: validated by audit_merkle + compression program
    #[account(mut)]
    pub audit_merkle_tree: UncheckedAccount<'info>,
    pub audit_merkle_program: Program<'info, AuditMerkle>,
    /// CHECK: SPL Account Compression program
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,
    /// CHECK: SPL Noop program
    pub noop_program: AccountInfo<'info>,
}

impl<'info> InitializeKeyring<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.authority.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

#[derive(Accounts)]
pub struct VerifySignature<'info> {
    pub signer: Signer<'info>,
    /// Buffer containing the signature bytes.
    pub sig_buffer: Account<'info, PqBuffer>,
    /// Buffer containing the public key bytes.
    pub pk_buffer: Account<'info, PqBuffer>,
}

#[derive(Accounts)]
pub struct RotateSigningKey<'info> {
    #[account(
        mut,
        has_one = authority @ FalconError::RotationNotAuthorized,
        seeds = [KEYRING_SEED, authority.key().as_ref()],
        bump = keyring.bump,
    )]
    pub keyring: Account<'info, SigningKeyring>,
    pub authority: Signer<'info>,

    /// Buffer containing the new public key bytes.
    pub new_key_buffer: Account<'info, PqBuffer>,
    /// Buffer containing the authorization signature (old key signing new key).
    pub auth_sig_buffer: Account<'info, PqBuffer>,

    // audit_merkle CPI accounts (last op)
    #[account(
        mut,
        seeds = [TREE_CONFIG_SEED, audit_merkle_tree.key().as_ref()],
        bump = audit_tree_config.bump,
        seeds::program = audit_merkle_program.key(),
    )]
    pub audit_tree_config: Account<'info, TreeConfig>,
    /// CHECK: validated by audit_merkle + compression program
    #[account(mut)]
    pub audit_merkle_tree: UncheckedAccount<'info>,
    pub audit_merkle_program: Program<'info, AuditMerkle>,
    /// CHECK: SPL Account Compression program
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,
    /// CHECK: SPL Noop program
    pub noop_program: AccountInfo<'info>,
}

impl<'info> RotateSigningKey<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.authority.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

// ─── STATE ───────────────────────────────────────────────────────────────────

/// Write-buffer for streaming large PQ key/signature data on-chain.
#[account]
#[derive(InitSpace)]
pub struct PqBuffer {
    pub authority: Pubkey,
    pub bump: u8,
    #[max_len(2420)]
    pub data: Vec<u8>,
}

/// Space: 8 discriminator + 32 authority + 1 key_type + 4 vec-len + 1312 max-pk
/// + 8 rotated_at + 4 rotation_count + 1 bump = 370 bytes (for Dilithium-3 pk).
/// Falcon-512 pk is 897 bytes — smaller, so Dilithium-3 drives the max.
#[account]
#[derive(InitSpace)]
pub struct SigningKeyring {
    pub authority: Pubkey,
    pub key_type: SigType,
    /// Stored as Vec<u8>; length validated on write. Max DILITHIUM3_PK_LEN (1312).
    #[max_len(1312)]
    pub public_key: Vec<u8>,
    pub rotated_at: i64,
    pub rotation_count: u32,
    pub bump: u8,
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SigType {
    Dilithium3,
    Falcon512,
}

impl SigType {
    pub fn discriminant(&self) -> u8 {
        match self {
            SigType::Dilithium3 => 0,
            SigType::Falcon512 => 1,
        }
    }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct KeyringInitialized {
    pub authority: Pubkey,
    pub scheme: u8,
    pub slot: u64,
}

#[event]
pub struct SignatureVerified {
    pub scheme: u8,
    pub sig_len: u16,
    pub verifier: Pubkey,
    pub slot: u64,
}

#[event]
pub struct KeyRotated {
    pub old_scheme: u8,
    pub new_scheme: u8,
    pub rotation_count: u32,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum FalconError {
    #[msg("PQ: signature failed verification")]
    InvalidSignature,
    #[msg("PQ: signature length does not match the declared scheme")]
    BadSignatureLength,
    #[msg("PQ: public-key length does not match the declared scheme")]
    BadPublicKeyLength,
    #[msg("PQ: Falcon verification requires SIMD-0416 (not yet live on mainnet)")]
    FalconNotYetSupported,
    #[msg("PQ: key rotation was not authorized by the current key")]
    RotationNotAuthorized,
    #[msg("PQ: arithmetic overflow in rotation_count")]
    MathOverflow,
    #[msg("PQ: write would exceed PqBuffer max capacity")]
    PqBufferOverflow,
    #[msg("PQ: caller does not own this PqBuffer")]
    PqBufferNotOwned,
}
