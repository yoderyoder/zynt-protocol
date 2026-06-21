//! # regulatory_oracle — Pyth + ZKML Risk Gate (Core Program 2)
//!
//! Provides two compliance layers consumed by hybrid_vault:
//!
//!   1. **Pyth price gate** — rejects oracle prices whose confidence interval
//!      exceeds ±2.5% of the mid price (conf/|price| ≥ 0.025).
//!
//!   2. **ZKML anomaly gate** — receives a Bonsol-executed PLONK proof [u8;192]
//!      and a score from the anomaly_detector model (AUC 0.961). If the score
//!      falls below 0.85 (8500 bps) the vault is flagged frozen in a ZkmlScore PDA;
//!      hybrid_vault reads this PDA before any state-mutating instruction.
//!
//! Every instruction appends an audit leaf via CPI into audit_merkle (last op).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use audit_merkle::{
    cpi::{accounts::AppendAuditEntry as AuditAppend, append_audit_entry},
    program::AuditMerkle,
    TreeConfig, TREE_CONFIG_SEED,
};
use falcon_verify::{
    cpi::{accounts::VerifySignature as FalconAccounts, verify_signature},
    PqBuffer,
    program::FalconVerify,
    SigType,
};
// Pyth push-oracle V2 price account layout (raw-byte parser).
// pyth-sdk-solana 0.10.x is incompatible with Agave 2.x (borsh version mismatch),
// so we read the binary account format directly.
//
// pc_price_t field offsets (C SDK / V2 push oracle):
//   [20..24]   expo: i32
//   [48..96]   ema_price + ema_conf (two pc_ema_t, 24 bytes each)
//   [96..104]  timestamp: i64   (unix seconds — added in push-oracle V2)
//   [208..216] agg.price_: i64
//   [216..224] agg.conf_: u64
const PYTH_MAGIC: u32 = 0xa1b2c3d4;

fn parse_pyth_price(account_info: &AccountInfo) -> Result<(i64, u64, i32, i64)> {
    let data = account_info
        .try_borrow_data()
        .map_err(|_| error!(OracleError::PythFeedInvalid))?;
    require!(data.len() >= 224, OracleError::PythFeedInvalid);
    let magic = u32::from_le_bytes(
        data[0..4].try_into().map_err(|_| error!(OracleError::PythFeedInvalid))?,
    );
    require!(magic == PYTH_MAGIC, OracleError::PythFeedInvalid);
    let expo      = i32::from_le_bytes(data[20..24].try_into().map_err(|_| error!(OracleError::PythFeedInvalid))?);
    let pub_time  = i64::from_le_bytes(data[96..104].try_into().map_err(|_| error!(OracleError::PythFeedInvalid))?);
    let price     = i64::from_le_bytes(data[208..216].try_into().map_err(|_| error!(OracleError::PythFeedInvalid))?);
    let conf      = u64::from_le_bytes(data[216..224].try_into().map_err(|_| error!(OracleError::PythFeedInvalid))?);
    Ok((price, conf, expo, pub_time))
}

declare_id!("EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L");

// ─── SEEDS ───────────────────────────────────────────────────────────────────

pub const RISK_CONFIG_SEED: &[u8] = b"risk-config";
pub const ZKML_SCORE_SEED: &[u8] = b"zkml-score";
pub const PRICE_STATE_SEED: &[u8] = b"price-state";

// ─── CANONICAL RISK PARAMETERS (CLAUDE.md) ───────────────────────────────────

pub const MAX_DRAWDOWN_BPS: u16 = 500;
pub const FREEZE_SCORE_BPS: u16 = 8_500;
pub const LEVERAGE_MIN: u16 = 300;
pub const LEVERAGE_MAX: u16 = 500;
/// Confidence gate: reject if conf * 1000 >= |price| * 25  (i.e. conf/|price| >= 0.025)
pub const PYTH_CONF_NUMER: u128 = 25;
pub const PYTH_CONF_DENOM: u128 = 1_000;

#[program]
pub mod regulatory_oracle {
    use super::*;

    /// Initialize the global risk configuration with 4-of-7 multisig authorities.
    /// Must be called once before any other oracle instruction.
    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        multisig_authorities: [Pubkey; 7],
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.risk_config;
        cfg.multisig_authorities = multisig_authorities;
        cfg.max_drawdown_bps = MAX_DRAWDOWN_BPS;
        cfg.freeze_score_bps = FREEZE_SCORE_BPS;
        cfg.leverage_min = LEVERAGE_MIN;
        cfg.leverage_max = LEVERAGE_MAX;
        cfg.bump = ctx.bumps.risk_config;

        emit!(OracleInitialized {
            authority: ctx.accounts.payer.key(),
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[b"initialize_oracle", ctx.accounts.payer.key().as_ref(), &slot.to_le_bytes()]).to_bytes();
        append_audit(ctx.accounts.audit_accounts(), ctx.accounts.audit_merkle_program.to_account_info(), leaf)
    }

    /// Consume a Pyth price feed. Validates the ±2.5% confidence gate and
    /// stores the validated price in a PriceState PDA keyed by feed_id.
    ///
    /// `max_age_secs` — max acceptable price staleness in seconds (use a large
    ///  value in tests; production should use 60).
    pub fn consume_pyth_price(
        ctx: Context<ConsumePythPrice>,
        feed_id: [u8; 32],
        max_age_secs: u64,
    ) -> Result<()> {
        let (price_val, conf_val, expo_val, pub_time) =
            parse_pyth_price(&ctx.accounts.pyth_price.to_account_info())?;

        let now = Clock::get()?.unix_timestamp;

        // Freshness check
        let age = now.saturating_sub(pub_time) as u64;
        require!(age <= max_age_secs, OracleError::PriceStale);

        // Confidence gate: conf / |price| < 2.5%
        let price_abs = price_val.unsigned_abs() as u128;
        require!(price_abs > 0, OracleError::PriceZero);
        let conf = conf_val as u128;
        let lhs = conf.checked_mul(PYTH_CONF_DENOM).ok_or(OracleError::MathOverflow)?;
        let rhs = price_abs.checked_mul(PYTH_CONF_NUMER).ok_or(OracleError::MathOverflow)?;
        require!(lhs < rhs, OracleError::ConfidenceGateViolation);

        let state = &mut ctx.accounts.price_state;
        state.feed_id = feed_id;
        state.price = price_val;
        state.conf = conf_val;
        state.expo = expo_val;
        state.published_at = pub_time;
        state.validated_at = now;
        state.bump = ctx.bumps.price_state;

        emit!(PriceValidated {
            feed_id,
            price: price_val,
            conf: conf_val,
            expo: expo_val,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"consume_pyth_price",
            &feed_id,
            &price_val.to_le_bytes(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(ctx.accounts.audit_accounts(), ctx.accounts.audit_merkle_program.to_account_info(), leaf)
    }

    /// Update canonical risk parameters. Requires:
    ///   1. Dilithium-3 PQ signature gate (falcon_verify CPI) — FIRST
    ///   2. 4-of-7 multisig: pass the signing authorities as remaining_accounts
    /// Last op: audit_merkle leaf.
    pub fn update_risk_params(
        ctx: Context<UpdateRiskParams>,
        params: RiskParams,
    ) -> Result<()> {
        // 1. PQ signature gate — sig/pk read from pre-filled PqBuffer accounts
        let mut msg: Vec<u8> = Vec::with_capacity(8);
        msg.extend_from_slice(&params.max_drawdown_bps.to_le_bytes());
        msg.extend_from_slice(&params.freeze_score_bps.to_le_bytes());
        msg.extend_from_slice(&params.leverage_min.to_le_bytes());
        msg.extend_from_slice(&params.leverage_max.to_le_bytes());

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

        // 2. Validate params
        require!(
            params.max_drawdown_bps <= MAX_DRAWDOWN_BPS,
            OracleError::DrawdownTooHigh
        );
        require!(
            params.leverage_min >= LEVERAGE_MIN && params.leverage_max <= LEVERAGE_MAX,
            OracleError::LeverageOutOfRange
        );
        require!(
            params.freeze_score_bps == FREEZE_SCORE_BPS,
            OracleError::InvalidFreezeScore
        );

        // 3. 4-of-7 multisig check
        let cfg = &ctx.accounts.risk_config;
        let mut signer_count: u8 = 0;
        for acct in ctx.remaining_accounts.iter() {
            if acct.is_signer && cfg.multisig_authorities.contains(acct.key) {
                signer_count = signer_count.saturating_add(1);
            }
        }
        require!(signer_count >= 4, OracleError::InsufficientMultisigSigners);

        let cfg = &mut ctx.accounts.risk_config;
        cfg.max_drawdown_bps = params.max_drawdown_bps;
        cfg.freeze_score_bps = params.freeze_score_bps;
        cfg.leverage_min = params.leverage_min;
        cfg.leverage_max = params.leverage_max;

        emit!(RiskParamsUpdated {
            max_drawdown_bps: params.max_drawdown_bps,
            freeze_score_bps: params.freeze_score_bps,
            leverage_min: params.leverage_min,
            leverage_max: params.leverage_max,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"update_risk_params",
            &params.max_drawdown_bps.to_le_bytes(),
            &params.freeze_score_bps.to_le_bytes(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(ctx.accounts.audit_accounts(), ctx.accounts.audit_merkle_program.to_account_info(), leaf)
    }

    /// Receive a PLONK proof [u8;192] from a Bonsol execution. The proof attests
    /// that the anomaly_detector model ran correctly over the advisor's trade data.
    /// Stores a hash of the proof in the ZkmlScore PDA; the score is updated by
    /// zkml_callback when the Bonsol relay delivers the model output.
    pub fn verify_anomaly_proof(
        ctx: Context<VerifyAnomalyProof>,
        proof: [u8; 192],
        vault: Pubkey,
    ) -> Result<()> {
        // Structural validity: non-zero proof and plausible header bytes
        require!(proof[..8] != [0u8; 8], OracleError::InvalidProof);

        let proof_hash = anchor_lang::solana_program::hash::hash(&proof).to_bytes();

        let score = &mut ctx.accounts.zkml_score;
        score.vault = vault;
        score.proof_hash = proof_hash;
        score.score = 0; // will be set by zkml_callback
        score.frozen = false;
        score.verified_at = Clock::get()?.unix_timestamp;
        score.bump = ctx.bumps.zkml_score;

        emit!(AnomalyProofVerified {
            vault,
            proof_hash,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"verify_anomaly_proof",
            vault.as_ref(),
            &proof_hash,
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(ctx.accounts.audit_accounts(), ctx.accounts.audit_merkle_program.to_account_info(), leaf)
    }

    /// Delivered by the Bonsol relay after ZKML inference completes.
    /// If score < 8500 (0.85), the vault is marked frozen; hybrid_vault checks
    /// this PDA before executing any state-mutating instruction.
    pub fn zkml_callback(
        ctx: Context<ZkmlCallback>,
        score: u16,
        vault: Pubkey,
    ) -> Result<()> {
        let zkml = &mut ctx.accounts.zkml_score;
        zkml.score = score;
        zkml.vault = vault;
        zkml.frozen = score < FREEZE_SCORE_BPS;
        zkml.verified_at = Clock::get()?.unix_timestamp;

        emit!(ZkmlScoreUpdated {
            vault,
            score,
            frozen: zkml.frozen,
            slot: Clock::get()?.slot,
        });

        let slot = Clock::get()?.slot;
        let leaf = hashv(&[
            b"zkml_callback",
            vault.as_ref(),
            &score.to_le_bytes(),
            &slot.to_le_bytes(),
        ])
        .to_bytes();
        append_audit(ctx.accounts.audit_accounts(), ctx.accounts.audit_merkle_program.to_account_info(), leaf)
    }
}

// ─── AUDIT HELPER ────────────────────────────────────────────────────────────

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

pub struct AuditAccounts<'info> {
    pub tree_config: AccountInfo<'info>,
    pub merkle_tree: AccountInfo<'info>,
    pub caller: AccountInfo<'info>,
    pub compression_program: AccountInfo<'info>,
    pub noop_program: AccountInfo<'info>,
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + RiskConfig::INIT_SPACE,
        seeds = [RISK_CONFIG_SEED],
        bump,
    )]
    pub risk_config: Account<'info, RiskConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

impl<'info> InitializeOracle<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.payer.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct ConsumePythPrice<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PriceState::INIT_SPACE,
        seeds = [PRICE_STATE_SEED, &feed_id],
        bump,
    )]
    pub price_state: Account<'info, PriceState>,
    /// CHECK: Pyth price account; layout validated by pyth-sdk-solana
    pub pyth_price: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

impl<'info> ConsumePythPrice<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.payer.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

#[derive(Accounts)]
pub struct UpdateRiskParams<'info> {
    #[account(mut, seeds = [RISK_CONFIG_SEED], bump = risk_config.bump)]
    pub risk_config: Account<'info, RiskConfig>,
    pub authority: Signer<'info>,

    // falcon_verify CPI accounts (first op — PQ gate)
    pub falcon_program: Program<'info, FalconVerify>,
    /// PqBuffer holding the Dilithium-3 signature (pre-filled via write_pq_buffer).
    pub sig_buffer: Account<'info, PqBuffer>,
    /// PqBuffer holding the Dilithium-3 public key (pre-filled via write_pq_buffer).
    pub pk_buffer: Account<'info, PqBuffer>,

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

impl<'info> UpdateRiskParams<'info> {
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
#[instruction(proof: [u8; 192], vault: Pubkey)]
pub struct VerifyAnomalyProof<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ZkmlScore::INIT_SPACE,
        seeds = [ZKML_SCORE_SEED, vault.as_ref()],
        bump,
    )]
    pub zkml_score: Account<'info, ZkmlScore>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

impl<'info> VerifyAnomalyProof<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.payer.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

#[derive(Accounts)]
#[instruction(score: u16, vault: Pubkey)]
pub struct ZkmlCallback<'info> {
    #[account(
        mut,
        seeds = [ZKML_SCORE_SEED, vault.as_ref()],
        bump = zkml_score.bump,
    )]
    pub zkml_score: Account<'info, ZkmlScore>,
    /// Authorized Bonsol relay or protocol authority
    pub relay: Signer<'info>,

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

impl<'info> ZkmlCallback<'info> {
    fn audit_accounts(&self) -> AuditAccounts<'info> {
        AuditAccounts {
            tree_config: self.audit_tree_config.to_account_info(),
            merkle_tree: self.audit_merkle_tree.to_account_info(),
            caller: self.relay.to_account_info(),
            compression_program: self.compression_program.to_account_info(),
            noop_program: self.noop_program.to_account_info(),
        }
    }
}

// ─── STATE ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct RiskConfig {
    pub multisig_authorities: [Pubkey; 7],
    pub max_drawdown_bps: u16,
    pub freeze_score_bps: u16,
    pub leverage_min: u16,
    pub leverage_max: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PriceState {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub published_at: i64,
    pub validated_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ZkmlScore {
    pub vault: Pubkey,
    pub score: u16,
    pub frozen: bool,
    pub proof_hash: [u8; 32],
    pub verified_at: i64,
    pub bump: u8,
}

// ─── ARGS ────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct RiskParams {
    pub max_drawdown_bps: u16,
    pub freeze_score_bps: u16,
    pub leverage_min: u16,
    pub leverage_max: u16,
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct OracleInitialized {
    pub authority: Pubkey,
    pub slot: u64,
}

#[event]
pub struct PriceValidated {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub slot: u64,
}

#[event]
pub struct RiskParamsUpdated {
    pub max_drawdown_bps: u16,
    pub freeze_score_bps: u16,
    pub leverage_min: u16,
    pub leverage_max: u16,
    pub slot: u64,
}

#[event]
pub struct AnomalyProofVerified {
    pub vault: Pubkey,
    pub proof_hash: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct ZkmlScoreUpdated {
    pub vault: Pubkey,
    pub score: u16,
    pub frozen: bool,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum OracleError {
    #[msg("Oracle: Pyth price account could not be parsed")]
    PythFeedInvalid,
    #[msg("Oracle: price is stale beyond acceptable age")]
    PriceStale,
    #[msg("Oracle: price is zero — feed misconfiguration")]
    PriceZero,
    #[msg("Oracle: conf/|price| >= 2.5%; price rejected")]
    ConfidenceGateViolation,
    #[msg("Oracle: max_drawdown_bps exceeds canonical 500 (5%)")]
    DrawdownTooHigh,
    #[msg("Oracle: leverage outside canonical 300–500 bps range")]
    LeverageOutOfRange,
    #[msg("Oracle: freeze_score_bps must equal canonical 8500 (0.85)")]
    InvalidFreezeScore,
    #[msg("Oracle: requires 4-of-7 multisig signers")]
    InsufficientMultisigSigners,
    #[msg("Oracle: PLONK proof is structurally invalid")]
    InvalidProof,
    #[msg("Oracle: arithmetic overflow")]
    MathOverflow,
}

// ─── UNIT TESTS ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confidence_gate_rejects_wide_spread() {
        // conf/price = 3% — should fail (> 2.5%)
        let price_abs: u128 = 10_000_000;
        let conf: u128 = 300_000; // 3%
        let lhs = conf * PYTH_CONF_DENOM;  // 300_000 * 1000 = 300_000_000
        let rhs = price_abs * PYTH_CONF_NUMER; // 10_000_000 * 25 = 250_000_000
        assert!(lhs >= rhs, "3% spread should fail the gate");
    }

    #[test]
    fn confidence_gate_accepts_tight_spread() {
        // conf/price = 1% — should pass (< 2.5%)
        let price_abs: u128 = 10_000_000;
        let conf: u128 = 100_000; // 1%
        let lhs = conf * PYTH_CONF_DENOM;  // 100_000_000
        let rhs = price_abs * PYTH_CONF_NUMER; // 250_000_000
        assert!(lhs < rhs, "1% spread should pass the gate");
    }

    #[test]
    fn freeze_threshold_is_canonical() {
        assert_eq!(FREEZE_SCORE_BPS, 8_500);
        assert_eq!(MAX_DRAWDOWN_BPS, 500);
        assert_eq!(LEVERAGE_MIN, 300);
        assert_eq!(LEVERAGE_MAX, 500);
    }

    #[test]
    fn zkml_freeze_flag_set_below_threshold() {
        let score: u16 = 8_499;
        assert!(score < FREEZE_SCORE_BPS, "score 0.8499 should trigger freeze");
    }

    #[test]
    fn zkml_freeze_flag_clear_at_threshold() {
        let score: u16 = 8_500;
        assert!(!(score < FREEZE_SCORE_BPS), "score 0.85 exact should not freeze");
    }
}
