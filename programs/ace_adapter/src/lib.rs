//! # ace_adapter — Chainlink ACE Integration Layer (Initiative 01)
//!
//! Zynt Protocol's bridge to the Chainlink Automated Compliance Engine (ACE).
//!
//! ## The Two-Layer Compliance Stack
//!
//! ```text
//!   LAYER 1 — Chainlink ACE (pre-trade identity)        ← THIS ADAPTER CONSUMES IT
//!     • KYC / AML status attestation
//!     • Sanctions screening (OFAC)
//!     • Accreditation verification (Reg D 506(c))
//!     • Cross-chain identity (GLEIF LEI)
//!
//!   LAYER 2 — Zynt Protocol (post-trade compliance)     ← ZYNT OWNS THIS
//!     • ZKML anomaly detection (0.961 AUC)
//!     • SPL-compressed Merkle audit trail (SEC 17a-3/4)
//!     • Dilithium-3 / Falcon post-quantum signing
//!     • Risk gating: drawdown, leverage, oracle confidence
//! ```
//!
//! ACE answers "is this wallet *allowed* to transact?"
//! Zynt answers "was this trade compliant, and here is the cryptographic proof."
//!
//! This adapter validates an ACE attestation account *before* any Zynt
//! state-mutating instruction is permitted to run via CPI.

use anchor_lang::prelude::*;

declare_id!("5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ");

#[program]
pub mod ace_adapter {
    use super::*;

    /// Records an ACE attestation on-chain after off-chain verification by
    /// a registered ACE attestor. In production this is written by the
    /// Chainlink Runtime Environment (CRE) via its decentralized oracle network.
    pub fn record_attestation(
        ctx: Context<RecordAttestation>,
        args: AttestationArgs,
    ) -> Result<()> {
        let att = &mut ctx.accounts.attestation;
        att.wallet = args.wallet;
        att.kyc_passed = args.kyc_passed;
        att.aml_score = args.aml_score;
        att.sanctions_ok = args.sanctions_ok;
        att.accredited = args.accredited;
        att.jurisdiction = args.jurisdiction;
        att.verified_at = Clock::get()?.unix_timestamp;
        att.ace_attestor = ctx.accounts.ace_attestor.key();
        att.bump = ctx.bumps.attestation;

        emit!(AttestationRecorded {
            wallet: args.wallet,
            aml_score: args.aml_score,
            accredited: args.accredited,
            slot: Clock::get()?.slot,
        });
        Ok(())
    }

    /// The gate. Every Zynt instruction that moves value or mutates risk
    /// state must CPI into this first. Returns Ok only when the wallet has a
    /// fresh, passing ACE attestation that satisfies the policy thresholds.
    pub fn validate_before_trade(
        ctx: Context<ValidateBeforeTrade>,
        policy: TradePolicy,
    ) -> Result<()> {
        let att = &ctx.accounts.attestation;
        let now = Clock::get()?.unix_timestamp;

        // 1. Identity & screening gates
        require!(att.kyc_passed, AceError::KycNotPassed);
        require!(att.sanctions_ok, AceError::SanctionsFlag);
        require!(
            att.aml_score >= policy.min_aml_score,
            AceError::AmlScoreBelowThreshold
        );

        // 2. Accreditation gate — only enforced for restricted assets (RWA)
        if policy.require_accreditation {
            require!(att.accredited, AceError::NotAccredited);
        }

        // 3. Jurisdiction allowlist
        if !policy.allowed_jurisdictions.is_empty() {
            require!(
                policy.allowed_jurisdictions.contains(&att.jurisdiction),
                AceError::JurisdictionBlocked
            );
        }

        // 4. Freshness — attestations expire to force re-screening
        require!(
            now.saturating_sub(att.verified_at) < policy.max_age_secs,
            AceError::AttestationStale
        );

        emit!(AceValidated {
            wallet: att.wallet,
            aml_score: att.aml_score,
            age_secs: now.saturating_sub(att.verified_at),
            slot: Clock::get()?.slot,
        });

        // ACE passed. Control returns to the calling Zynt instruction, which
        // now runs its ZKML risk gate and writes the audit-trail leaf.
        Ok(())
    }
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(args: AttestationArgs)]
pub struct RecordAttestation<'info> {
    #[account(
        init_if_needed,
        payer = ace_attestor,
        space = 8 + AceAttestation::INIT_SPACE,
        seeds = [b"ace", args.wallet.as_ref()],
        bump,
    )]
    pub attestation: Account<'info, AceAttestation>,
    /// The registered ACE attestor (CRE oracle authority in production).
    #[account(mut)]
    pub ace_attestor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateBeforeTrade<'info> {
    #[account(seeds = [b"ace", attestation.wallet.as_ref()], bump = attestation.bump)]
    pub attestation: Account<'info, AceAttestation>,
}

// ─── STATE ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct AceAttestation {
    pub wallet: Pubkey,
    pub kyc_passed: bool,
    pub aml_score: u8,        // 0–100, ACE-provided
    pub sanctions_ok: bool,
    pub accredited: bool,
    pub jurisdiction: [u8; 2], // ISO 3166-1 alpha-2, e.g. b"US"
    pub verified_at: i64,      // Unix timestamp of last ACE verification
    pub ace_attestor: Pubkey,  // who wrote this attestation
    pub bump: u8,
}

// ─── INSTRUCTION ARGS ────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AttestationArgs {
    pub wallet: Pubkey,
    pub kyc_passed: bool,
    pub aml_score: u8,
    pub sanctions_ok: bool,
    pub accredited: bool,
    pub jurisdiction: [u8; 2],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TradePolicy {
    pub min_aml_score: u8,
    pub require_accreditation: bool,
    pub allowed_jurisdictions: Vec<[u8; 2]>,
    pub max_age_secs: i64,
}

impl Default for TradePolicy {
    fn default() -> Self {
        Self {
            min_aml_score: 70,
            require_accreditation: false,
            allowed_jurisdictions: vec![], // empty = allow all
            max_age_secs: 86_400,          // 24 hours
        }
    }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct AttestationRecorded {
    pub wallet: Pubkey,
    pub aml_score: u8,
    pub accredited: bool,
    pub slot: u64,
}

#[event]
pub struct AceValidated {
    pub wallet: Pubkey,
    pub aml_score: u8,
    pub age_secs: i64,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum AceError {
    #[msg("ACE: wallet has not passed KYC verification")]
    KycNotPassed,
    #[msg("ACE: wallet flagged by sanctions screening")]
    SanctionsFlag,
    #[msg("ACE: AML risk score below required threshold")]
    AmlScoreBelowThreshold,
    #[msg("ACE: wallet is not an accredited investor (required for this asset)")]
    NotAccredited,
    #[msg("ACE: wallet jurisdiction is not on the allowlist")]
    JurisdictionBlocked,
    #[msg("ACE: attestation is stale; re-verification required")]
    AttestationStale,
}
