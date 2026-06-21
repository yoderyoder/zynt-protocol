//! # audit_merkle — Immutable Audit Trail (Core Program 3)
//!
//! Wraps SPL ConcurrentMerkleTree at depth 20 to produce an SEC 17a-3/4
//! compliant append-only audit log. Every state-mutating Zynt instruction
//! must CPI into `append_audit_entry` as its **last** operation.
//!
//! Leaf encoding: SHA-256(instruction_tag || payload_bytes || slot_le_bytes)
//! computed by the caller; this program only appends the 32-byte digest.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use spl_account_compression::cpi::{
    accounts::{Modify, VerifyLeaf},
    append, verify_leaf,
};

declare_id!("86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM");

pub const TREE_CONFIG_SEED: &[u8] = b"tree-config";
pub const CANONICAL_DEPTH: u32 = 20;

#[program]
pub mod audit_merkle {
    use super::*;

    /// Create and configure the ConcurrentMerkleTree. The merkle_tree account
    /// must be pre-allocated by the caller (system program createAccount) to
    /// the exact size returned by getConcurrentMerkleTreeAccountSize(20, buffer).
    pub fn initialize_merkle_tree(
        ctx: Context<InitializeMerkleTree>,
        max_depth: u32,
        max_buffer_size: u32,
    ) -> Result<()> {
        require!(max_depth == CANONICAL_DEPTH, AuditError::InvalidDepth);

        let merkle_tree_key = ctx.accounts.merkle_tree.key();
        let bump = ctx.bumps.tree_config;
        let seeds: &[&[u8]] = &[TREE_CONFIG_SEED, merkle_tree_key.as_ref(), &[bump]];

        // Call SPL Account Compression's init_empty_merkle_tree via invoke_signed so we
        // can explicitly mark merkle_tree as writable. The local spl-account-compression 1.0.0
        // crate has #[account(zero)] commented out in Initialize, which causes ToAccountMetas
        // to emit is_writable=false — but the deployed program expects writable.
        // Discriminator: sha256("global:init_empty_merkle_tree")[0..8]
        let mut init_data = vec![191u8, 11, 119, 7, 180, 107, 220, 110];
        init_data.extend_from_slice(&max_depth.to_le_bytes());
        init_data.extend_from_slice(&max_buffer_size.to_le_bytes());

        invoke_signed(
            &Instruction {
                program_id: ctx.accounts.compression_program.key(),
                accounts: vec![
                    AccountMeta { pubkey: ctx.accounts.merkle_tree.key(), is_signer: false, is_writable: true },
                    AccountMeta { pubkey: ctx.accounts.tree_config.key(), is_signer: true, is_writable: false },
                    AccountMeta { pubkey: ctx.accounts.noop_program.key(), is_signer: false, is_writable: false },
                ],
                data: init_data,
            },
            &[
                ctx.accounts.merkle_tree.to_account_info(),
                ctx.accounts.tree_config.to_account_info(),
                ctx.accounts.noop_program.to_account_info(),
            ],
            &[seeds],
        )?;

        let cfg = &mut ctx.accounts.tree_config;
        cfg.merkle_tree = merkle_tree_key;
        cfg.authority = ctx.accounts.payer.key();
        cfg.leaf_count = 0;
        cfg.bump = bump;

        emit!(MerkleTreeInitialized {
            merkle_tree: merkle_tree_key,
            max_depth,
            max_buffer_size,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    /// Append a 32-byte SHA-256 leaf. Called via CPI by every Zynt instruction
    /// as its last operation. The tree_config PDA signs on behalf of the tree.
    pub fn append_audit_entry(
        ctx: Context<AppendAuditEntry>,
        leaf_data: [u8; 32],
    ) -> Result<()> {
        let merkle_tree_key = ctx.accounts.merkle_tree.key();
        let bump = ctx.accounts.tree_config.bump;
        let seeds: &[&[u8]] = &[TREE_CONFIG_SEED, merkle_tree_key.as_ref(), &[bump]];

        append(
            CpiContext::new_with_signer(
                ctx.accounts.compression_program.to_account_info(),
                Modify {
                    merkle_tree: ctx.accounts.merkle_tree.to_account_info(),
                    authority: ctx.accounts.tree_config.to_account_info(),
                    noop: ctx.accounts.noop_program.to_account_info(),
                },
                &[seeds],
            ),
            leaf_data,
        )?;

        let cfg = &mut ctx.accounts.tree_config;
        cfg.leaf_count = cfg.leaf_count.checked_add(1).ok_or(AuditError::Overflow)?;

        emit!(AuditLeafAppended {
            leaf_hash: leaf_data,
            leaf_index: cfg.leaf_count.saturating_sub(1),
            appended_by: ctx.accounts.caller.key(),
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    /// Verify an inclusion proof. Proof nodes are passed as remaining_accounts
    /// where each account's pubkey encodes the 32-byte proof hash node.
    pub fn verify_audit_path<'info>(
        ctx: Context<'_, '_, '_, 'info, VerifyAuditPath<'info>>,
        leaf: [u8; 32],
        root: [u8; 32],
        index: u32,
    ) -> Result<()> {
        let proof_nodes: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
        verify_leaf(
            CpiContext::new(
                ctx.accounts.compression_program.to_account_info(),
                VerifyLeaf {
                    merkle_tree: ctx.accounts.merkle_tree.to_account_info(),
                },
            )
            .with_remaining_accounts(proof_nodes),
            root,
            leaf,
            index,
        )?;

        emit!(AuditPathVerified {
            leaf_hash: leaf,
            root,
            index,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMerkleTree<'info> {
    /// CHECK: pre-allocated by caller; structure validated by compression program
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + TreeConfig::INIT_SPACE,
        seeds = [TREE_CONFIG_SEED, merkle_tree.key().as_ref()],
        bump,
    )]
    pub tree_config: Account<'info, TreeConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: SPL Account Compression program (cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK)
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,
    /// CHECK: SPL Noop program (noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV)
    pub noop_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendAuditEntry<'info> {
    #[account(
        mut,
        seeds = [TREE_CONFIG_SEED, merkle_tree.key().as_ref()],
        bump = tree_config.bump,
    )]
    pub tree_config: Account<'info, TreeConfig>,
    /// CHECK: validated by compression program
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: pubkey recorded in event; appended leaf is immutable regardless of caller
    pub caller: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression program
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,
    /// CHECK: SPL Noop program
    pub noop_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct VerifyAuditPath<'info> {
    /// CHECK: validated by compression program; proof nodes in remaining_accounts
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: SPL Account Compression program
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,
}

// ─── STATE ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct TreeConfig {
    pub merkle_tree: Pubkey,
    pub authority: Pubkey,
    pub leaf_count: u64,
    pub bump: u8,
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct MerkleTreeInitialized {
    pub merkle_tree: Pubkey,
    pub max_depth: u32,
    pub max_buffer_size: u32,
    pub slot: u64,
}

#[event]
pub struct AuditLeafAppended {
    pub leaf_hash: [u8; 32],
    pub leaf_index: u64,
    pub appended_by: Pubkey,
    pub slot: u64,
}

#[event]
pub struct AuditPathVerified {
    pub leaf_hash: [u8; 32],
    pub root: [u8; 32],
    pub index: u32,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum AuditError {
    #[msg("Audit: tree depth must be exactly 20 (canonical Zynt depth)")]
    InvalidDepth,
    #[msg("Audit: arithmetic overflow in leaf counter")]
    Overflow,
}

// ─── UNIT TESTS ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_depth_is_twenty() {
        assert_eq!(CANONICAL_DEPTH, 20);
    }

    #[test]
    fn tree_config_init_space() {
        // 32 (merkle_tree) + 32 (authority) + 8 (leaf_count) + 1 (bump) = 73
        assert_eq!(TreeConfig::INIT_SPACE, 73);
    }
}
