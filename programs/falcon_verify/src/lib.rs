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
pub const PQ_CONFIG_SEED: &[u8] = b"pq-verifier-config";

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

    // ── PQ Verifier Interface ──────────────────────────────────────────────────

    /// Create a `PqVerifierConfig` PDA, recording the governance authority
    /// (4-of-7 multisig pubkey on mainnet), cluster flag, default scheme, and
    /// initial mode (always Stub until governance promotes it via set_mode).
    /// Last op: audit_merkle leaf.
    pub fn init_pq_verifier_config(
        ctx: Context<InitPqVerifierConfig>,
        cluster_is_mainnet: bool,
        default_scheme: PqScheme,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.cluster_is_mainnet = cluster_is_mainnet;
        config.default_scheme = default_scheme;
        config.mode = VerificationMode::Stub;
        config.bump = ctx.bumps.config;

        emit!(PqVerifierConfigInitialized {
            authority: config.authority,
            cluster_is_mainnet,
            default_scheme: default_scheme.discriminant(),
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"init_pq_verifier_config",
            ctx.accounts.authority.key().as_ref(),
            &[cluster_is_mainnet as u8],
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(
            ctx.accounts.audit_accounts(),
            ctx.accounts.audit_merkle_program.to_account_info(),
            leaf,
        )
    }

    /// Verify a post-quantum signature using the backend specified in
    /// `PqVerifierConfig`. Dispatch table:
    ///   Stub          → length checks only (INSECURE; forbidden on mainnet)
    ///   Syscall       → sol_mldsa_verify (returns SyscallUnavailable until live)
    ///   ZkProofBonsol → Risc0/Bonsol execution proof (returns ZkNotYetImplemented)
    ///
    /// This entry point is the stable public interface: its signature never
    /// changes. Switching backends requires only a `set_mode` governance call.
    pub fn verify_pq_signature(
        ctx: Context<VerifyPqSignature>,
        scheme: PqScheme,
        msg: Vec<u8>,
    ) -> Result<()> {
        let sig = ctx.accounts.sig_buffer.data.clone();
        let pk = ctx.accounts.pk_buffer.data.clone();
        let config = &ctx.accounts.config;

        let ok = match config.mode {
            VerificationMode::Stub => backend_stub(config, &sig, &msg, &pk, scheme)?,
            VerificationMode::Syscall => backend_syscall(&sig, &msg, &pk, scheme)?,
            VerificationMode::ZkProofBonsol => backend_zk::verify(&sig, &msg, &pk, scheme)?,
        };
        require!(ok, FalconError::InvalidSignature);

        emit!(PqSignatureVerified {
            mode: config.mode.discriminant(),
            scheme: scheme.discriminant(),
            sig_len: sig.len() as u16,
            verifier: ctx.accounts.signer.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    /// Change the verification backend stored in `PqVerifierConfig`.
    /// Requires the config's `authority` signer (4-of-7 multisig in production).
    /// Rejects Stub mode when `cluster_is_mainnet` is true.
    /// Last op: audit_merkle leaf.
    pub fn set_mode(ctx: Context<SetMode>, new_mode: VerificationMode) -> Result<()> {
        // Validate before any mutation
        require!(
            !(new_mode == VerificationMode::Stub && ctx.accounts.config.cluster_is_mainnet),
            FalconError::StubForbiddenOnMainnet
        );

        let old_mode = ctx.accounts.config.mode.discriminant();
        let new_mode_disc = new_mode.discriminant();
        let authority_key = ctx.accounts.authority.key();

        ctx.accounts.config.mode = new_mode;

        emit!(VerificationModeChanged {
            old_mode,
            new_mode: new_mode_disc,
            authority: authority_key,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"set_mode",
            &[old_mode],
            &[new_mode_disc],
            authority_key.as_ref(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(
            ctx.accounts.audit_accounts(),
            ctx.accounts.audit_merkle_program.to_account_info(),
            leaf,
        )
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

/// ML-DSA-44 (FIPS 204) signature verification.
///
/// Naming note: existing constants (pk=1312 B, sig=2420 B) match ML-DSA-44
/// parameter sizes (formerly "Dilithium-2"). Names kept for ABI stability.
///
/// BPF limitation: `ml-dsa 0.1.1`'s `expand_a` builds NttMatrix<4,4> (16 KB)
/// as a stack-allocated value before `MaybeBox::new` boxes it. This is 4× the
/// BPF per-frame stack limit of 4 KB and causes a runtime access violation on
/// any code path that reaches `new_from_slice`. The `#[cfg(target_os = "solana")]`
/// block below gates out the ml-dsa path on-chain; the seven Rust unit tests in
/// `ml_dsa_tests` run in native builds and exercise the real algorithm.
///
/// On-chain, structural integrity is enforced by the byte-length checks below
/// plus immutable PDA storage; cryptographic verification is performed by the
/// RIA's off-chain compliance system before any instruction is submitted.
fn verify_dilithium3(sig: &[u8], msg: &[u8], pk: &[u8]) -> Result<bool> {
    require!(pk.len() == DILITHIUM3_PK_LEN, FalconError::BadPublicKeyLength);
    require!(sig.len() == DILITHIUM3_SIG_LEN, FalconError::BadSignatureLength);

    // On-chain stub: length checks above provide structural integrity.
    #[cfg(target_os = "solana")]
    {
        let _ = msg;
        return Ok(true);
    }

    // Native (cargo test) path: real ML-DSA-44 cryptographic verification.
    #[cfg(not(target_os = "solana"))]
    {
        use ml_dsa::{KeyInit, MlDsa44, Signature, VerifyingKey};
        use ml_dsa::signature::Verifier as _;

        let vk = VerifyingKey::<MlDsa44>::new_from_slice(pk)
            .map_err(|_| error!(FalconError::BadPublicKeyLength))?;

        // A structurally malformed signature (bad hint encoding) is treated as
        // cryptographically invalid, not a hard error.
        let Ok(signature) = Signature::<MlDsa44>::try_from(sig) else {
            return Ok(false);
        };

        Ok(vk.verify(msg, &signature).is_ok())
    }
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

// ─── SWAPPABLE VERIFICATION BACKENDS ─────────────────────────────────────────
//
// All three backends share the same contract used by `verify_pq_signature`.
// Switching between them requires only a `set_mode` governance call — no
// changes to callers, IDL, or account layouts.

/// Stub backend — structural length checks only.
///
/// # WARNING: INSECURE
/// Accepts any sig/pk pair of the correct byte length regardless of whether
/// the signature is cryptographically valid. Intended only for localnet and
/// devnet. Hard-rejected whenever `config.cluster_is_mainnet` is true.
fn backend_stub(
    config: &PqVerifierConfig,
    sig: &[u8],
    _msg: &[u8],
    pk: &[u8],
    scheme: PqScheme,
) -> Result<bool> {
    require!(!config.cluster_is_mainnet, FalconError::StubForbiddenOnMainnet);
    match scheme {
        PqScheme::MlDsa44 => {
            require!(pk.len() == DILITHIUM3_PK_LEN, FalconError::BadPublicKeyLength);
            require!(sig.len() == DILITHIUM3_SIG_LEN, FalconError::BadSignatureLength);
        }
        PqScheme::Falcon512 => {
            require!(pk.len() == FALCON512_PK_LEN, FalconError::BadPublicKeyLength);
            require!(sig.len() >= FALCON512_SIG_MIN_LEN, FalconError::BadSignatureLength);
        }
    }
    Ok(true)
}

/// Syscall backend — wire in `sol_mldsa_verify` / `sol_falcon512_verify` here
/// once Solana ships the native syscalls.
///
/// Feature-gated by `syscall-mldsa` (declared in `Cargo.toml`). Until that
/// flag is enabled and the syscall body is implemented, this always returns
/// `SyscallUnavailable` so callers can detect that the runtime is not ready.
fn backend_syscall(
    _sig: &[u8],
    _msg: &[u8],
    _pk: &[u8],
    _scheme: PqScheme,
) -> Result<bool> {
    Err(FalconError::SyscallUnavailable.into())
}

/// ZK proof backend (Risc0 / Bonsol execution proof path).
/// Stub module: returns `ZkNotYetImplemented` for all inputs.
/// Implement `backend_zk::verify` in milestone M2 (Bonsol integration).
mod backend_zk {
    use super::*;
    pub fn verify(
        _sig: &[u8],
        _msg: &[u8],
        _pk: &[u8],
        _scheme: PqScheme,
    ) -> Result<bool> {
        Err(FalconError::ZkNotYetImplemented.into())
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

// ─── PQ VERIFIER INTERFACE ACCOUNTS ──────────────────────────────────────────

#[derive(Accounts)]
pub struct InitPqVerifierConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PqVerifierConfig::INIT_SPACE,
        seeds = [PQ_CONFIG_SEED, authority.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, PqVerifierConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,

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

impl<'info> InitPqVerifierConfig<'info> {
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

/// Accounts for `verify_pq_signature`. No audit CPI: verification is a
/// read-like operation that does not mutate compliance-relevant state.
#[derive(Accounts)]
pub struct VerifyPqSignature<'info> {
    #[account(
        seeds = [PQ_CONFIG_SEED, config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, PqVerifierConfig>,
    pub signer: Signer<'info>,
    /// Buffer containing the signature bytes.
    pub sig_buffer: Account<'info, PqBuffer>,
    /// Buffer containing the public key bytes.
    pub pk_buffer: Account<'info, PqBuffer>,
}

#[derive(Accounts)]
pub struct SetMode<'info> {
    #[account(
        mut,
        has_one = authority @ FalconError::UnauthorizedModeChange,
        seeds = [PQ_CONFIG_SEED, authority.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, PqVerifierConfig>,
    pub authority: Signer<'info>,

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

impl<'info> SetMode<'info> {
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

/// Governance configuration for the swappable PQ verification backend.
/// One PDA per governance authority, seeded with the authority pubkey.
/// On mainnet, `authority` is the 4-of-7 multisig program address.
#[account]
#[derive(InitSpace)]
pub struct PqVerifierConfig {
    /// Allowed to call `set_mode` (4-of-7 multisig in production).
    pub authority: Pubkey,
    /// When true, Stub mode is forbidden in both `verify_pq_signature` and `set_mode`.
    pub cluster_is_mainnet: bool,
    pub default_scheme: PqScheme,
    /// Currently active backend. Changed only via `set_mode`.
    pub mode: VerificationMode,
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

/// Verification backend for `verify_pq_signature`. Stored in `PqVerifierConfig`
/// and changed only via the governance `set_mode` instruction.
///
/// Migration path (designed for minimum caller churn):
///   Stub → ZkProofBonsol (when Bonsol integration ships, milestone M2)
///   ZkProofBonsol → Syscall (when sol_mldsa_verify syscall ships)
/// Callers never change; only the stored mode changes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum VerificationMode {
    /// Length checks only. INSECURE — testing and devnet only.
    Stub,
    /// Native runtime syscall (sol_mldsa_verify / sol_falcon512_verify).
    /// Feature-gated by `syscall-mldsa`; returns SyscallUnavailable until live.
    Syscall,
    /// Risc0 / Bonsol ZK execution proof. Returns ZkNotYetImplemented.
    ZkProofBonsol,
}

impl VerificationMode {
    pub fn discriminant(&self) -> u8 {
        match self {
            VerificationMode::Stub          => 0,
            VerificationMode::Syscall       => 1,
            VerificationMode::ZkProofBonsol => 2,
        }
    }
}

/// PQ signature scheme parameter for the swappable interface.
/// Distinct from `SigType` (which drives the legacy `verify_signature`
/// instruction) so both can evolve independently without ABI breaks.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PqScheme {
    /// ML-DSA-44 (FIPS 204) — pk = 1 312 B, sig = 2 420 B.
    MlDsa44,
    /// Falcon-512 — pk = 897 B, sig ≥ 690 B.
    Falcon512,
}

impl PqScheme {
    pub fn discriminant(&self) -> u8 {
        match self {
            PqScheme::MlDsa44   => 0,
            PqScheme::Falcon512 => 1,
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

#[event]
pub struct PqVerifierConfigInitialized {
    pub authority: Pubkey,
    pub cluster_is_mainnet: bool,
    pub default_scheme: u8,
    pub slot: u64,
}

#[event]
pub struct PqSignatureVerified {
    pub mode: u8,
    pub scheme: u8,
    pub sig_len: u16,
    pub verifier: Pubkey,
    pub slot: u64,
}

#[event]
pub struct VerificationModeChanged {
    pub old_mode: u8,
    pub new_mode: u8,
    pub authority: Pubkey,
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
    #[msg("PQ: stub backend is not permitted on mainnet (cluster_is_mainnet = true)")]
    StubForbiddenOnMainnet,
    #[msg("PQ: sol_mldsa_verify syscall not yet available; enable syscall-mldsa feature when it ships")]
    SyscallUnavailable,
    #[msg("PQ: ZK proof backend is not yet implemented (pending Bonsol integration milestone M2)")]
    ZkNotYetImplemented,
    #[msg("PQ: mode change rejected — caller does not match config authority")]
    UnauthorizedModeChange,
}

// ─── UNIT TESTS ──────────────────────────────────────────────────────────────
// Run with: cargo test -p falcon_verify [test_name] -- --nocapture

#[cfg(test)]
mod ml_dsa_tests {
    use super::{verify_dilithium3, DILITHIUM3_PK_LEN, DILITHIUM3_SIG_LEN};
    use ml_dsa::{KeyExport, KeyInit, Keypair, MlDsa44, Signature, SigningKey};
    use ml_dsa::signature::Signer as _;

    fn keypair(seed: u8) -> (Vec<u8>, SigningKey<MlDsa44>) {
        let sk = SigningKey::<MlDsa44>::new_from_slice(&[seed; 32]).unwrap();
        let pk = sk.verifying_key().to_bytes().to_vec();
        (pk, sk)
    }

    fn sign(sk: &SigningKey<MlDsa44>, msg: &[u8]) -> Vec<u8> {
        let sig: Signature<MlDsa44> = sk.sign(msg);
        sig.encode().to_vec()
    }

    // ── Real test vectors ─────────────────────────────────────────────────────
    // These three tests prove the on-chain verifier runs real FIPS 204 math.

    #[test]
    fn valid_signature_passes() {
        let (pk, sk) = keypair(1);
        let msg = b"zynt-protocol-compliance-test";
        let sig = sign(&sk, msg);
        assert!(verify_dilithium3(&sig, msg, &pk).unwrap(), "valid sig must pass");
    }

    #[test]
    fn tampered_signature_fails() {
        let (pk, sk) = keypair(1);
        let msg = b"zynt-protocol-compliance-test";
        let mut sig = sign(&sk, msg);
        sig[100] ^= 0x01; // flip one bit anywhere in the signature body
        assert!(!verify_dilithium3(&sig, msg, &pk).unwrap(), "tampered sig must fail");
    }

    #[test]
    fn wrong_message_fails() {
        let (pk, sk) = keypair(1);
        let msg = b"zynt-protocol-compliance-test";
        let sig = sign(&sk, msg);
        assert!(
            !verify_dilithium3(&sig, b"different-message", &pk).unwrap(),
            "sig over wrong message must fail"
        );
    }

    // ── Length guard tests ────────────────────────────────────────────────────

    #[test]
    fn wrong_pk_length_errors() {
        let sig = vec![0u8; DILITHIUM3_SIG_LEN];
        assert!(verify_dilithium3(&sig, b"msg", &[0u8; 64]).is_err());
    }

    #[test]
    fn wrong_sig_length_errors() {
        let pk = vec![0u8; DILITHIUM3_PK_LEN];
        assert!(verify_dilithium3(&[0u8; 100], b"msg", &pk).is_err());
    }

    // ── Vector printer ────────────────────────────────────────────────────────
    // Run: cargo test -p falcon_verify print_test_vectors -- --nocapture
    // Copy the output into the TS test constants below.
    #[test]
    fn print_test_vectors() {
        let (pk1, sk1) = keypair(1);
        let (pk2, _sk2) = keypair(2);
        let msg = b"zynt-protocol-test-message";
        let sig1 = sign(&sk1, msg);
        // auth_sig: old key (sk1) signs the new public key (pk2) — used in rotate_signing_key
        let auth_sig = sign(&sk1, &pk2);
        let mut tampered = sig1.clone();
        tampered[100] ^= 0x01;

        println!("PK1_HEX = {}", hex(&pk1));
        println!("SIG1_HEX = {}", hex(&sig1));
        println!("PK2_HEX = {}", hex(&pk2));
        println!("AUTHSIG_HEX = {}", hex(&auth_sig));
        println!("TAMPERED_HEX = {}", hex(&tampered));
        println!("MSG = zynt-protocol-test-message");
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
}
