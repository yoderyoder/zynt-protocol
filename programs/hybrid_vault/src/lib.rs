//! # hybrid_vault — Token-2022 Vault (Core Program 1)
//!
//! Entry point for all Zynt Protocol value flows. Layered compliance stack:
//!
//!   deposit
//!     ├─▶ ace_adapter::validate_before_trade (KYC/AML/sanctions gate — FIRST)
//!     └─▶ audit_merkle::append_audit_entry (last op)
//!
//!   withdraw
//!     └─▶ audit_merkle::append_audit_entry (last op)
//!
//!   rebalance
//!     ├─▶ ace_adapter::validate_before_trade (KYC/AML/sanctions gate — FIRST)
//!     ├─▶ regulatory_oracle::verify_anomaly_proof (PLONK gate + oracle audit leaf)
//!     └─▶ audit_merkle::append_audit_entry (rebalance audit leaf — last op)
//!
//!   freeze_account                               privileged
//!     ├─▶ falcon_verify::verify_signature (Dilithium-3 PQ gate)
//!     ├─▶ 4-of-7 multisig check (remaining_accounts)
//!     └─▶ audit_merkle::append_audit_entry (last op)

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use ace_adapter::{
    cpi::{accounts::ValidateBeforeTrade as AceAccounts, validate_before_trade},
    program::AceAdapter,
    AceAttestation, TradePolicy,
};
use audit_merkle::{
    cpi::{accounts::AppendAuditEntry as AuditAppend, append_audit_entry},
    program::AuditMerkle,
    TreeConfig, TREE_CONFIG_SEED,
};
use falcon_verify::{
    cpi::{accounts::VerifySignature as FalconAccounts, verify_signature},
    program::FalconVerify,
    PqBuffer, SigType,
};
use regulatory_oracle::{
    cpi::{accounts::VerifyAnomalyProof as OracleAccounts, verify_anomaly_proof},
    program::RegulatoryOracle,
    ZkmlScore, FREEZE_SCORE_BPS,
};

declare_id!("8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y");

pub const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod hybrid_vault {
    use super::*;

    /// Create the vault with a 4-of-7 multisig authority set.
    /// Last op: audit_merkle leaf.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        multisig_authorities: [Pubkey; 7],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.multisig_authorities = multisig_authorities;
        vault.total_deposits = 0;
        vault.ace_validated = false;
        vault.frozen = false;
        vault.bump = ctx.bumps.vault;

        emit!(VaultInitialized {
            vault: ctx.accounts.vault.key(),
            authority: ctx.accounts.authority.key(),
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"initialize_vault",
            ctx.accounts.vault.key().as_ref(),
            ctx.accounts.authority.key().as_ref(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit_cpi(ctx.accounts.audit_cpi(), leaf)
    }

    /// Deposit Token-2022 tokens into the vault.
    /// ACE pre-trade gate runs FIRST, before any other check or mutation.
    /// Last op: audit_merkle leaf.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // ── GATE 1: ACE compliance — must be the very first operation ────────
        validate_before_trade(
            CpiContext::new(
                ctx.accounts.ace_program.to_account_info(),
                AceAccounts {
                    attestation: ctx.accounts.ace_attestation.to_account_info(),
                },
            ),
            TradePolicy::default(),
        )?;

        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.frozen, VaultError::VaultFrozen);

        let vault = &mut ctx.accounts.vault;
        vault.total_deposits = vault
            .total_deposits
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Deposited {
            vault: ctx.accounts.vault.key(),
            user: ctx.accounts.user.key(),
            amount,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"deposit",
            ctx.accounts.vault.key().as_ref(),
            ctx.accounts.user.key().as_ref(),
            &amount.to_le_bytes(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit_cpi(ctx.accounts.audit_cpi(), leaf)
    }

    /// Withdraw Token-2022 tokens from the vault (vault PDA signs).
    /// Last op: audit_merkle leaf.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault.frozen, VaultError::VaultFrozen);
        require!(
            ctx.accounts.vault.total_deposits >= amount,
            VaultError::InsufficientFunds
        );

        // Copy immutable fields before mutable borrow
        let authority_key = ctx.accounts.vault.authority;
        let bump = ctx.accounts.vault.bump;

        let vault = &mut ctx.accounts.vault;
        vault.total_deposits = vault
            .total_deposits
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;

        let seeds: &[&[u8]] = &[VAULT_SEED, authority_key.as_ref(), &[bump]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Withdrawn {
            vault: ctx.accounts.vault.key(),
            user: ctx.accounts.user.key(),
            amount,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"withdraw",
            ctx.accounts.vault.key().as_ref(),
            ctx.accounts.user.key().as_ref(),
            &amount.to_le_bytes(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit_cpi(ctx.accounts.audit_cpi(), leaf)
    }

    /// Rebalance vault allocation. The PLONK proof [u8;192] is forwarded to
    /// regulatory_oracle::verify_anomaly_proof which appends its own audit leaf.
    /// If a ZkmlScore account exists for this vault and is frozen, this rejects.
    /// ACE pre-trade gate runs FIRST, before any other check or mutation.
    /// Last op: rebalance's own audit_merkle leaf.
    pub fn rebalance(ctx: Context<Rebalance>, proof: [u8; 192]) -> Result<()> {
        // ── GATE 1: ACE compliance — must be the very first operation ────────
        validate_before_trade(
            CpiContext::new(
                ctx.accounts.ace_program.to_account_info(),
                AceAccounts {
                    attestation: ctx.accounts.ace_attestation.to_account_info(),
                },
            ),
            TradePolicy::default(),
        )?;

        require!(!ctx.accounts.vault.frozen, VaultError::VaultFrozen);

        // Read ZKML freeze flag from the oracle-owned score PDA if it exists.
        // Borrow + deserialize inside a block so the Ref<> is dropped before the CPI.
        let zkml_frozen: bool =
            if *ctx.accounts.zkml_score.owner == regulatory_oracle::ID
                && !ctx.accounts.zkml_score.data_is_empty()
            {
                let account_data = ctx.accounts.zkml_score.data.borrow();
                let mut slice: &[u8] = &account_data;
                let zkml = ZkmlScore::try_deserialize(&mut slice)
                    .map_err(|_| error!(VaultError::ZkmlDataCorrupt))?;
                zkml.frozen
            } else {
                false
            };
        // Ref<> dropped at end of block above — safe to CPI below
        require!(!zkml_frozen, VaultError::ZkmlFreezeActive);

        // CPI: regulatory_oracle::verify_anomaly_proof (→ also appends oracle audit leaf)
        let vault_key = ctx.accounts.vault.key();
        verify_anomaly_proof(
            CpiContext::new(
                ctx.accounts.oracle_program.to_account_info(),
                OracleAccounts {
                    zkml_score: ctx.accounts.zkml_score.clone(),
                    payer: ctx.accounts.authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    audit_tree_config: ctx.accounts.audit_tree_config.to_account_info(),
                    audit_merkle_tree: ctx.accounts.audit_merkle_tree.to_account_info(),
                    audit_merkle_program: ctx.accounts.audit_merkle_program.to_account_info(),
                    compression_program: ctx.accounts.compression_program.to_account_info(),
                    noop_program: ctx.accounts.noop_program.to_account_info(),
                },
            ),
            proof,
            vault_key,
        )?;

        emit!(Rebalanced {
            vault: vault_key,
            proof_hash: anchor_lang::solana_program::hash::hash(&proof).to_bytes(),
            slot: Clock::get()?.slot,
        });

        // Last op: rebalance's own audit leaf
        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"rebalance",
            vault_key.as_ref(),
            &proof[..32],
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit_cpi(ctx.accounts.audit_cpi(), leaf)
    }

    /// Freeze a vault. Privileged instruction requires:
    ///   1. Dilithium-3 PQ signature (falcon_verify CPI via sig_buffer + pk_buffer)
    ///   2. 4-of-7 multisig (≥4 matching remaining_accounts signers)
    /// Last op: audit_merkle leaf.
    pub fn freeze_account(
        ctx: Context<FreezeAccount>,
        target: Pubkey,
    ) -> Result<()> {
        // 1. PQ signature gate — sig/pk read from pre-filled PqBuffer accounts
        let msg = target.to_bytes().to_vec();
        verify_signature(
            CpiContext::new(
                ctx.accounts.falcon_program.to_account_info(),
                FalconAccounts {
                    signer: ctx.accounts.authority.to_account_info(),
                    sig_buffer: ctx.accounts.sig_buffer.to_account_info(),
                    pk_buffer: ctx.accounts.pk_buffer.to_account_info(),
                },
            ),
            SigType::Dilithium3,
            msg,
        )?;

        // 2. 4-of-7 multisig check
        let vault = &ctx.accounts.vault;
        let mut signer_count: u8 = 0;
        for acct in ctx.remaining_accounts.iter() {
            if acct.is_signer && vault.multisig_authorities.contains(acct.key) {
                signer_count = signer_count.saturating_add(1);
            }
        }
        require!(signer_count >= 4, VaultError::InsufficientMultisigSigners);

        // 3. Freeze
        let vault = &mut ctx.accounts.vault;
        vault.frozen = true;

        emit!(AccountFrozen {
            vault: vault.key(),
            target,
            frozen_by: ctx.accounts.authority.key(),
            slot: Clock::get()?.slot,
        });

        // 4. Last op: audit leaf
        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"freeze_account",
            target.as_ref(),
            ctx.accounts.authority.key().as_ref(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit_cpi(ctx.accounts.audit_cpi(), leaf)
    }
}

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────

struct AuditCpi<'info> {
    tree_config: AccountInfo<'info>,
    merkle_tree: AccountInfo<'info>,
    caller: AccountInfo<'info>,
    compression_program: AccountInfo<'info>,
    noop_program: AccountInfo<'info>,
    program: AccountInfo<'info>,
}

fn append_audit_cpi<'info>(cpi: AuditCpi<'info>, leaf: [u8; 32]) -> Result<()> {
    append_audit_entry(
        CpiContext::new(
            cpi.program,
            AuditAppend {
                tree_config: cpi.tree_config,
                merkle_tree: cpi.merkle_tree,
                caller: cpi.caller,
                compression_program: cpi.compression_program,
                noop_program: cpi.noop_program,
            },
        ),
        leaf,
    )
}

// audit_cpi() impl shared across all instruction contexts via macro
macro_rules! impl_audit_cpi {
    ($ctx:ty, $caller_field:ident) => {
        impl<'info> $ctx {
            fn audit_cpi(&self) -> AuditCpi<'info> {
                AuditCpi {
                    tree_config: self.audit_tree_config.to_account_info(),
                    merkle_tree: self.audit_merkle_tree.to_account_info(),
                    caller: self.$caller_field.to_account_info(),
                    compression_program: self.compression_program.to_account_info(),
                    noop_program: self.noop_program.to_account_info(),
                    program: self.audit_merkle_program.to_account_info(),
                }
            }
        }
    };
}

// ─── ACCOUNT STRUCTS ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [VAULT_SEED, authority.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,

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

impl_audit_cpi!(InitializeVault<'info>, authority);

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,

    /// ACE attestation PDA for the depositing user. Validated by ace_adapter CPI.
    #[account(
        seeds = [b"ace", user.key().as_ref()],
        bump = ace_attestation.bump,
        seeds::program = ace_program.key(),
    )]
    pub ace_attestation: Account<'info, AceAttestation>,
    pub ace_program: Program<'info, AceAdapter>,

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

impl_audit_cpi!(Deposit<'info>, user);

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

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

impl_audit_cpi!(Withdraw<'info>, user);

#[derive(Accounts)]
pub struct Rebalance<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,

    /// ACE attestation PDA for the rebalancing authority. Validated by ace_adapter CPI.
    #[account(
        seeds = [b"ace", authority.key().as_ref()],
        bump = ace_attestation.bump,
        seeds::program = ace_program.key(),
    )]
    pub ace_attestation: Account<'info, AceAttestation>,
    pub ace_program: Program<'info, AceAdapter>,

    /// CHECK: ZkmlScore PDA [b"zkml-score", vault] owned by regulatory_oracle.
    /// Writable because verify_anomaly_proof uses init_if_needed.
    /// Owner check + deserialization done inside the instruction before any mutation.
    #[account(mut)]
    pub zkml_score: AccountInfo<'info>,
    pub oracle_program: Program<'info, RegulatoryOracle>,

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

impl_audit_cpi!(Rebalance<'info>, authority);

#[derive(Accounts)]
pub struct FreezeAccount<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.authority.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub falcon_program: Program<'info, FalconVerify>,

    /// PqBuffer holding the Dilithium-3 signature (pre-filled via write_pq_buffer).
    pub sig_buffer: Account<'info, PqBuffer>,
    /// PqBuffer holding the Dilithium-3 public key (pre-filled via write_pq_buffer).
    pub pk_buffer: Account<'info, PqBuffer>,

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

impl_audit_cpi!(FreezeAccount<'info>, authority);

// ─── STATE ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub authority: Pubkey,
    pub multisig_authorities: [Pubkey; 7],
    pub total_deposits: u64,
    /// Set true by Phase-1 ace_adapter CPI
    pub ace_validated: bool,
    pub frozen: bool,
    pub bump: u8,
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub slot: u64,
}

#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct Rebalanced {
    pub vault: Pubkey,
    pub proof_hash: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct AccountFrozen {
    pub vault: Pubkey,
    pub target: Pubkey,
    pub frozen_by: Pubkey,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum VaultError {
    #[msg("Vault: amount must be greater than zero")]
    ZeroAmount,
    #[msg("Vault: vault is frozen — all operations suspended")]
    VaultFrozen,
    #[msg("Vault: ACE compliance gate rejected this wallet — check KYC/AML/sanctions status")]
    AceGateFailed,
    #[msg("Vault: ZKML anomaly score is below 0.85 freeze threshold")]
    ZkmlFreezeActive,
    #[msg("Vault: ZKML score account data is corrupt")]
    ZkmlDataCorrupt,
    #[msg("Vault: insufficient deposited balance for withdrawal")]
    InsufficientFunds,
    #[msg("Vault: arithmetic overflow")]
    MathOverflow,
    #[msg("Vault: privileged instruction requires 4-of-7 multisig signers")]
    InsufficientMultisigSigners,
}

// ─── UNIT TESTS ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_state_init_space_is_correct() {
        // 32 (authority) + 224 ([Pubkey;7]) + 8 (total_deposits)
        // + 1 (ace_validated) + 1 (frozen) + 1 (bump) = 267
        assert_eq!(VaultState::INIT_SPACE, 267);
    }

    #[test]
    fn freeze_score_imported_from_oracle_matches_canonical() {
        assert_eq!(FREEZE_SCORE_BPS, 8_500);
    }

    #[test]
    fn checked_sub_prevents_underflow() {
        let balance: u64 = 50;
        let withdrawal: u64 = 100;
        assert!(balance.checked_sub(withdrawal).is_none());
    }

    #[test]
    fn checked_add_prevents_overflow() {
        assert!(u64::MAX.checked_add(1).is_none());
    }
}
