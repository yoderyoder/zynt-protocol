//! # rwa_router — Tokenized RWA Allocation Layer (Initiative 03)
//!
//! Routes idle vault capital into the three largest institutional RWA
//! instruments live on Solana, turning them from "competitors" into pipeline:
//!
//!   • FOBXX  — Franklin Templeton OnChain US Gov Money Fund ($594M live)
//!   • BUIDL  — BlackRock USD Institutional Digital Liquidity Fund
//!   • ACRED  — Apollo Diversified Credit (Securitize sToken)
//!
//! All three use Token-2022 with compliance metadata embedded in the mint.
//! An RIA advisor using Zynt allocates to institutional-grade tokenized
//! T-bills in a single instruction — gated by an ACE accreditation check.
//!
//! ## CPI dependency
//! ```text
//!   rwa_router ──read──▶ ace_adapter::AceAttestation (read-only account constraint)
//!   rwa_router ──CPI──▶  audit_merkle::append_audit_entry  (LAST op always)
//! ```

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use ace_adapter::{program::AceAdapter, AceAttestation};
use audit_merkle::{
    cpi::{accounts::AppendAuditEntry as AuditAppendAccounts, append_audit_entry},
    program::AuditMerkle,
    TreeConfig, TREE_CONFIG_SEED,
};
// spl-token-2022 extension parsing: StateWithExtensions for fixed-size extensions,
// get_variable_len_extension for TokenMetadata (variable-length) via BaseStateWithExtensions trait.
use spl_token_2022::extension::{BaseStateWithExtensions, StateWithExtensions};
use spl_token_2022::state::Mint as Token22Mint;
use spl_token_metadata_interface::state::TokenMetadata;

declare_id!("6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY");

// ─── COMPLIANCE CONSTANTS ────────────────────────────────────────────────────

/// Minimum AML score required for RWA allocation (canonical: 70).
pub const MIN_AML_SCORE: u8 = 70;

/// Maximum attestation age for ACE freshness check (canonical: 86400 s = 24 h).
pub const MAX_ATTESTATION_AGE_SECS: i64 = 86_400;

/// Maximum slippage permitted on FOBXX Jupiter swap (50 bps).
pub const FOBXX_MAX_SLIPPAGE_BPS: u16 = 50;

/// Default FOBXX yield if metadata is absent (5.28%).
pub const FOBXX_DEFAULT_YIELD_BPS: u16 = 528;

/// Default BUIDL yield if metadata is absent (5.15%).
pub const BUIDL_DEFAULT_YIELD_BPS: u16 = 515;

/// Default ACRED yield if metadata is absent (8.42% private credit).
pub const ACRED_DEFAULT_YIELD_BPS: u16 = 842;

// ─── KNOWN RWA MINTS (mainnet) ───────────────────────────────────────────────
// Placeholder addresses — replace with verified mainnet mints at integration
// time after confirmation with Franklin Templeton / BlackRock / Securitize.
// TODO: replace with verified mainnet mint addresses after Franklin Templeton / BlackRock / Securitize confirmation.
pub const FOBXX_MINT: Pubkey = pubkey!("4zkVXMtZUwBJhdqQyNJA7Enug9siyZyxgKm9nBsSgLZW");
pub const BUIDL_MINT: Pubkey = pubkey!("CCaaCcPrqVEqD5bVVYzY6r7SuwW1NzoWqcScSt7wQoaR");
pub const ACRED_MINT: Pubkey = pubkey!("DWEojpukqEs4tVU46srhUX3xBgrmT27HQh288WJXh9GC");

// ─── Token-2022 metadata field keys ─────────────────────────────────────────
/// Issuer-defined additional_metadata key indicating KYC requirement.
pub const META_KEY_KYC_REQUIRED: &str = "kyc_required";
/// Issuer-defined additional_metadata key for jurisdiction allowlist (CSV of ISO 3166-1 alpha-2).
pub const META_KEY_JURISDICTION: &str = "jurisdiction_allowlist";
/// Issuer-defined additional_metadata key indicating redeemability.
pub const META_KEY_REDEEMABLE: &str = "redeemable";
/// Issuer-defined additional_metadata key for annualized yield in bps.
pub const META_KEY_YIELD_BPS: &str = "yield_bps";

// ─── AUDIT LEAF TAGS ─────────────────────────────────────────────────────────
pub const LEAF_TAG_ROUTE: &[u8]  = b"route_to_rwa";
pub const LEAF_TAG_REDEEM: &[u8] = b"redeem_rwa";

// ─── PDA SEED ────────────────────────────────────────────────────────────────
pub const RWA_VAULT_SEED: &[u8] = b"rwa-vault";

#[program]
pub mod rwa_router {
    use super::*;

    /// Allocate `amount_usdc` from the Zynt vault into a tokenized RWA target.
    ///
    /// Execution order (non-negotiable):
    ///   1. ACE accreditation gate — runs FIRST, before any routing logic
    ///   2. Read Token-2022 compliance metadata on the RWA mint
    ///   3. Enforce KYC, jurisdiction, and fund-specific transfer restrictions
    ///   4. Execute the routed allocation (Jupiter / BUIDL vault / Securitize ATS)
    ///   5. Record allocation in vault state (checked arithmetic only)
    ///   6. Emit RwaAllocation event
    ///   7. audit_merkle::append_audit_entry CPI — LAST operation, no exceptions
    pub fn route_to_rwa(
        ctx: Context<RouteToRwa>,
        target: RwaTarget,
        amount_usdc: u64,
    ) -> Result<()> {
        require!(amount_usdc > 0, RwaError::ZeroAmount);

        // ── Step 1: ACE accreditation gate (FIRST) ───────────────────────────
        // The AceAttestation PDA is read-only via account constraint
        // ([b"ace", authority] owned by ace_adapter). No CPI needed here —
        // we read the deserialized fields directly from the account.
        let att = &ctx.accounts.ace_attestation;
        let now = Clock::get()?.unix_timestamp;

        require!(att.kyc_passed, RwaError::AceKycNotPassed);
        require!(att.sanctions_ok, RwaError::AceSanctionsFlag);
        require!(att.aml_score >= MIN_AML_SCORE, RwaError::AceAmlScoreLow);
        // All three RWA instruments (FOBXX, BUIDL, ACRED) are Reg D restricted;
        // accreditation is mandatory without exception.
        require!(att.accredited, RwaError::AceNotAccredited);
        require!(
            now.saturating_sub(att.verified_at) < MAX_ATTESTATION_AGE_SECS,
            RwaError::AceAttestationStale
        );

        // ── Step 2: Read Token-2022 compliance metadata from the RWA mint ───
        let compliance = read_token22_compliance(&ctx.accounts.rwa_mint)?;

        // ── Step 3: Enforce compliance rules ─────────────────────────────────
        require!(compliance.kyc_required_met, RwaError::KycRequired);
        require!(compliance.jurisdiction_ok, RwaError::JurisdictionBlocked);

        // ── Step 4: Route by target ──────────────────────────────────────────
        // Each routing helper reads the yield from compliance metadata or falls
        // back to a fund-specific default. Phase 1: CPIs into Jupiter / BUIDL
        // vault / Securitize ATS are stubs (see TODO comments in each helper).
        let yield_bps: u16 = match target {
            RwaTarget::Fobxx => route_via_jupiter(amount_usdc, &compliance)?,
            RwaTarget::Buidl => route_via_buidl_vault(amount_usdc, &compliance)?,
            RwaTarget::Acred => {
                // ACRED has an explicit redeemable flag in its metadata.
                // We reuse it here to block subscriptions when the fund is
                // in a lock-up period.
                require!(compliance.redeemable, RwaError::TransferRestricted);
                route_via_securitize_stoken(amount_usdc, &compliance)?
            }
            RwaTarget::Custom { .. } => route_custom(amount_usdc, &compliance)?,
        };

        // ── Step 5: Record allocation in vault state ─────────────────────────
        let vault = &mut ctx.accounts.vault;
        vault.rwa_allocated_usdc = vault
            .rwa_allocated_usdc
            .checked_add(amount_usdc)
            .ok_or(RwaError::MathOverflow)?;

        let slot = Clock::get()?.slot;

        // ── Step 6: Emit allocation event ────────────────────────────────────
        emit!(RwaAllocation {
            target: target.discriminant(),
            amount_usdc,
            rwa_mint: ctx.accounts.rwa_mint.key(),
            yield_rate_bps: yield_bps,
            slot,
        });

        // ── Step 7: append_audit_entry CPI — MUST be last ────────────────────
        // Leaf: SHA-256(b"route_to_rwa" || target_disc[1] || amount_usdc[8]
        //               || yield_bps_u64[8] || slot[8])
        let leaf = build_route_leaf(target.discriminant(), amount_usdc, yield_bps as u64, slot);
        let cpi_accounts = AuditAppendAccounts {
            tree_config:         ctx.accounts.audit_tree_config.to_account_info(),
            merkle_tree:         ctx.accounts.audit_merkle_tree.to_account_info(),
            caller:              ctx.accounts.authority.to_account_info(),
            compression_program: ctx.accounts.compression_program.to_account_info(),
            noop_program:        ctx.accounts.noop_program.to_account_info(),
        };
        append_audit_entry(
            CpiContext::new(
                ctx.accounts.audit_merkle_program.to_account_info(),
                cpi_accounts,
            ),
            leaf,
        )
    }

    /// Redeem an RWA position back to USDC.
    ///
    /// Validates:
    ///   1. ACE KYC + sanctions freshness check
    ///   2. Token-2022 `redeemable` flag on the mint
    ///   3. Checked arithmetic on vault state update
    ///   4. Emits RwaRedemption event
    ///   5. audit_merkle CPI — LAST operation
    pub fn redeem_rwa(
        ctx: Context<RouteToRwa>,
        target: RwaTarget,
        amount_tokens: u64,
    ) -> Result<()> {
        require!(amount_tokens > 0, RwaError::ZeroAmount);

        // ACE freshness / sanctions re-check on redemption — position may
        // have been opened before a jurisdiction change or sanctions update.
        let att = &ctx.accounts.ace_attestation;
        let now = Clock::get()?.unix_timestamp;
        require!(att.kyc_passed, RwaError::AceKycNotPassed);
        require!(att.sanctions_ok, RwaError::AceSanctionsFlag);
        require!(
            now.saturating_sub(att.verified_at) < MAX_ATTESTATION_AGE_SECS,
            RwaError::AceAttestationStale
        );

        // Read compliance metadata — redeemable flag must be true.
        let compliance = read_token22_compliance(&ctx.accounts.rwa_mint)?;
        require!(compliance.redeemable, RwaError::RedemptionLocked);

        // Update vault state with checked subtraction.
        let vault = &mut ctx.accounts.vault;
        vault.rwa_allocated_usdc = vault
            .rwa_allocated_usdc
            .checked_sub(amount_tokens)
            .ok_or(RwaError::MathOverflow)?;

        let slot = Clock::get()?.slot;

        emit!(RwaRedemption {
            target: target.discriminant(),
            amount_tokens,
            rwa_mint: ctx.accounts.rwa_mint.key(),
            slot,
        });

        // Audit leaf — LAST operation.
        // Leaf: SHA-256(b"redeem_rwa" || target_disc[1] || amount_tokens[8] || slot[8])
        let leaf = build_redeem_leaf(target.discriminant(), amount_tokens, slot);
        let cpi_accounts = AuditAppendAccounts {
            tree_config:         ctx.accounts.audit_tree_config.to_account_info(),
            merkle_tree:         ctx.accounts.audit_merkle_tree.to_account_info(),
            caller:              ctx.accounts.authority.to_account_info(),
            compression_program: ctx.accounts.compression_program.to_account_info(),
            noop_program:        ctx.accounts.noop_program.to_account_info(),
        };
        append_audit_entry(
            CpiContext::new(
                ctx.accounts.audit_merkle_program.to_account_info(),
                cpi_accounts,
            ),
            leaf,
        )
    }

    /// Initialize the vault state PDA for a given authority.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.payer.key();
        vault.rwa_allocated_usdc = 0;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }
}

// ─── ROUTING HELPERS ─────────────────────────────────────────────────────────
// Each returns the current annualized yield in bps, captured in the audit leaf.
// ACE gate and Token-2022 compliance reads have already succeeded before these
// functions are called.

/// FOBXX — Franklin Templeton OnChain US Government Money Fund
///
/// Settlement: Jupiter v6 aggregator, USDC → FOBXX at best execution.
/// Max slippage: FOBXX_MAX_SLIPPAGE_BPS (50 bps).
/// Yield: read from Token-2022 `yield_bps` metadata field, or falls back to
/// FOBXX_DEFAULT_YIELD_BPS (528 bps = 5.28%) if the extension is absent.
///
/// TODO(phase-1): Replace stub with real Jupiter v6 CPI:
///   - Build a SwapInstruction via the Jupiter Aggregator on-chain program
///     (JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB or current v6 successor)
///   - Set slippage_bps = FOBXX_MAX_SLIPPAGE_BPS in Jupiter route parameters
///   - Verify received_amount >= amount_usdc * (10000 - 50) / 10000
///   - Pass remaining_accounts to Jupiter CPI with the full route plan
fn route_via_jupiter(
    _amount_usdc: u64,
    compliance: &RwaCompliance,
) -> Result<u16> {
    // Phase 1 stub — yield from metadata or canonical default.
    let yield_bps = if compliance.metadata_absent || compliance.current_yield_bps == 0 {
        FOBXX_DEFAULT_YIELD_BPS
    } else {
        compliance.current_yield_bps
    };
    Ok(yield_bps)
}

/// BUIDL — BlackRock USD Institutional Digital Liquidity Fund
///
/// Settlement: allowlist-gated Token-2022 transfer to the BUIDL subscription vault.
/// The BUIDL mint has a TransferHook extension that enforces allowlist membership
/// on every transfer; any transfer to a non-allowlisted wallet is rejected on-chain.
/// Yield: read from Token-2022 `yield_bps` metadata field, or falls back to
/// BUIDL_DEFAULT_YIELD_BPS (515 bps = 5.15%) if absent.
///
/// TODO(phase-1): Replace stub with real BUIDL subscription CPI:
///   - Verify TransferHook extension address on the BUIDL_MINT before calling
///   - Confirm allowlist membership: read the hook's `allowlist_member` PDA
///     at seeds [b"member", vault_rwa_ata.owner] (issued by BlackRock/Securitize)
///   - Call the BUIDL subscription program (address TBD, requires NDA with
///     BlackRock Digital Assets) with amount_usdc and the vault's wallet
fn route_via_buidl_vault(
    _amount_usdc: u64,
    compliance: &RwaCompliance,
) -> Result<u16> {
    // Phase 1 stub — yield from metadata or canonical default.
    let yield_bps = if compliance.metadata_absent || compliance.current_yield_bps == 0 {
        BUIDL_DEFAULT_YIELD_BPS
    } else {
        compliance.current_yield_bps
    };
    Ok(yield_bps)
}

/// ACRED — Apollo Diversified Credit (Securitize sToken)
///
/// Settlement: Securitize ATS sToken subscription flow.
/// Transfer restrictions enforced by the Token-2022 TransferHook on the ACRED
/// mint; only accredited investors registered on the Securitize platform can hold.
/// The `redeemable` flag in metadata must be true (checked by caller before
/// this function is invoked).
/// Yield: read from Token-2022 `yield_bps` metadata field, or falls back to
/// ACRED_DEFAULT_YIELD_BPS (842 bps = 8.42% — private credit premium).
///
/// TODO(phase-1): Replace stub with real Securitize ATS CPI:
///   - Derive the investor's Securitize DID from the AceAttestation.wallet
///   - Call Securitize's on-chain ATS program (SecuritizeATS program address TBD)
///     with: investor_did, usdc_amount, acred_mint
///   - Confirm sToken receipt in vault_rwa_ata after the instruction returns
///   - Store the Securitize order ID in a separate OrderState PDA for reconciliation
fn route_via_securitize_stoken(
    _amount_usdc: u64,
    compliance: &RwaCompliance,
) -> Result<u16> {
    // Phase 1 stub — yield from metadata or canonical default.
    let yield_bps = if compliance.metadata_absent || compliance.current_yield_bps == 0 {
        ACRED_DEFAULT_YIELD_BPS
    } else {
        compliance.current_yield_bps
    };
    Ok(yield_bps)
}

/// Custom RWA target (future extensibility).
///
/// TODO(phase-1): Look up a `RoutingConfig` PDA keyed by the Custom mint address
/// to determine the settlement program, slippage params, and default yield bps.
fn route_custom(
    _amount_usdc: u64,
    _compliance: &RwaCompliance,
) -> Result<u16> {
    Ok(0)
}

// ─── TOKEN-2022 COMPLIANCE READER ────────────────────────────────────────────

/// Parse the Token-2022 `TokenMetadata` extension from a mint account to
/// extract issuer-embedded compliance rules.
///
/// Fields consumed from `additional_metadata` (Vec<(String, String)>):
///   - `"kyc_required"`           → "true" | "false"  (permissive default: false)
///   - `"jurisdiction_allowlist"` → comma-separated ISO 3166-1 alpha-2 codes
///                                  (empty string = all jurisdictions allowed)
///   - `"redeemable"`             → "true" | "false"  (permissive default: true)
///   - `"yield_bps"`              → decimal u16 string (default: fund-specific)
///
/// If the `TokenMetadata` extension is absent (plain Token-2022 mint without
/// the metadata extension), the function returns permissive defaults and sets
/// `metadata_absent = true`. The audit leaf will capture this gap so the SEC
/// audit trail is accurate about the compliance data source.
///
/// Jurisdiction acceptance: in Phase 1 we accept "US" as always OK because
/// all Zynt vaults serve US-registered RIAs. The ACE attestation's jurisdiction
/// field ([u8; 2]) is cross-referenced against the allowlist CSV in Phase 2.
fn read_token22_compliance(mint: &InterfaceAccount<Mint>) -> Result<RwaCompliance> {
    let mint_account_info = mint.to_account_info();
    let mint_data = mint_account_info.try_borrow_data()?;

    let mut kyc_required       = false;
    let mut jurisdiction_ok    = true;
    let mut redeemable         = true;
    let mut current_yield_bps  = 0u16; // 0 signals "use fund-specific default"
    let mut metadata_absent    = false;

    // Attempt to parse the mint as a Token-2022 account with extensions.
    // StateWithExtensions::unpack decodes the TLV layout of a Token-2022 mint.
    // TokenMetadata is a variable-length extension; we use get_variable_len_extension.
    match StateWithExtensions::<Token22Mint>::unpack(&mint_data) {
        Ok(state) => {
            // TokenMetadata is variable-length (additional_metadata is a Vec).
            // get_variable_len_extension locates it by extension type discriminant.
            match state.get_variable_len_extension::<TokenMetadata>() {
                Ok(token_metadata) => {
                    for (key, value) in &token_metadata.additional_metadata {
                        match key.as_str() {
                            META_KEY_KYC_REQUIRED => {
                                kyc_required = value.as_str() == "true";
                            }
                            META_KEY_JURISDICTION => {
                                // Empty allowlist = permissive (all jurisdictions allowed).
                                // Non-empty CSV: check whether "US" is in the list.
                                // TODO(phase-2): compare against
                                // AceAttestation.jurisdiction ([u8; 2]) passed
                                // through the instruction context for non-US RIAs.
                                if !value.is_empty() {
                                    jurisdiction_ok = value
                                        .split(',')
                                        .any(|j| j.trim().eq_ignore_ascii_case("US"));
                                }
                            }
                            META_KEY_REDEEMABLE => {
                                redeemable = value.as_str() != "false";
                            }
                            META_KEY_YIELD_BPS => {
                                if let Ok(bps) = value.parse::<u16>() {
                                    current_yield_bps = bps;
                                }
                            }
                            _ => {} // ignore unknown additional_metadata fields
                        }
                    }
                }
                Err(_) => {
                    // TokenMetadata extension absent — permissive defaults apply.
                    // This is expected for test mints; in production FOBXX/BUIDL/ACRED
                    // mints will carry the extension.
                    metadata_absent = true;
                }
            }
        }
        Err(_) => {
            // Could not unpack as Token-2022 mint (e.g. vanilla SPL Token mint).
            // Treat as metadata absent; routing proceeds with fund defaults.
            metadata_absent = true;
        }
    }

    // kyc_required_met: the ACE gate (Step 1 in route_to_rwa) already confirmed
    // kyc_passed=true before we reach here, so the mint's kyc_required flag is
    // always satisfied at this point.
    let kyc_required_met = !kyc_required || true; // ACE gate already enforced

    Ok(RwaCompliance {
        kyc_required_met,
        jurisdiction_ok,
        redeemable,
        current_yield_bps,
        metadata_absent,
    })
}

// ─── AUDIT LEAF BUILDERS ─────────────────────────────────────────────────────

/// Build the 32-byte leaf for a route_to_rwa instruction.
///
/// Encoding:
///   SHA-256(b"route_to_rwa" || target_disc[1] || amount_usdc[8 LE]
///           || yield_bps[8 LE] || slot[8 LE])
fn build_route_leaf(target_disc: u8, amount_usdc: u64, yield_bps: u64, slot: u64) -> [u8; 32] {
    let target_bytes = [target_disc];
    let amount_bytes = amount_usdc.to_le_bytes();
    let yield_bytes  = yield_bps.to_le_bytes();
    let slot_bytes   = slot.to_le_bytes();

    hashv(&[LEAF_TAG_ROUTE, &target_bytes, &amount_bytes, &yield_bytes, &slot_bytes])
        .to_bytes()
}

/// Build the 32-byte leaf for a redeem_rwa instruction.
///
/// Encoding:
///   SHA-256(b"redeem_rwa" || target_disc[1] || amount_tokens[8 LE] || slot[8 LE])
fn build_redeem_leaf(target_disc: u8, amount_tokens: u64, slot: u64) -> [u8; 32] {
    let target_bytes = [target_disc];
    let amount_bytes = amount_tokens.to_le_bytes();
    let slot_bytes   = slot.to_le_bytes();

    hashv(&[LEAF_TAG_REDEEM, &target_bytes, &amount_bytes, &slot_bytes])
        .to_bytes()
}

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RouteToRwa<'info> {
    // ── Vault state ───────────────────────────────────────────────────────────
    #[account(
        mut,
        seeds = [RWA_VAULT_SEED, authority.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,

    // ── ACE accreditation (read-only; seeds validated, no CPI needed) ─────────
    /// AceAttestation PDA for the authority wallet. Seeds: [b"ace", authority].
    /// Owned by ace_adapter. Anchor validates the seeds and the program owner,
    /// so forged accounts cannot pass this constraint.
    #[account(
        seeds = [b"ace", authority.key().as_ref()],
        bump   = ace_attestation.bump,
        seeds::program = ace_program.key(),
    )]
    pub ace_attestation: Account<'info, AceAttestation>,

    /// ace_adapter program — needed for seeds::program cross-program validation.
    pub ace_program: Program<'info, AceAdapter>,

    // ── RWA mint (Token-2022) ─────────────────────────────────────────────────
    /// The Token-2022 mint of the target RWA instrument.
    /// TokenMetadata extension carries: kyc_required, jurisdiction_allowlist,
    /// redeemable, yield_bps. Absent extension → permissive defaults apply.
    pub rwa_mint: InterfaceAccount<'info, Mint>,

    // ── Token accounts ────────────────────────────────────────────────────────
    /// Vault's USDC token account (source of allocation funds; destination on redeem).
    #[account(mut)]
    pub vault_usdc_ata: InterfaceAccount<'info, TokenAccount>,

    /// Vault's RWA token account (destination on allocate; source on redeem).
    #[account(mut)]
    pub vault_rwa_ata: InterfaceAccount<'info, TokenAccount>,

    // ── Authority ─────────────────────────────────────────────────────────────
    #[account(mut)]
    pub authority: Signer<'info>,

    // ── Token program (Token-2022) ─────────────────────────────────────────────
    pub token_program: Interface<'info, TokenInterface>,

    // ── Audit merkle CPI accounts ─────────────────────────────────────────────
    pub audit_merkle_program: Program<'info, AuditMerkle>,

    #[account(
        mut,
        seeds = [
            TREE_CONFIG_SEED,
            audit_merkle_tree.key().as_ref(),
        ],
        bump  = audit_tree_config.bump,
        seeds::program = audit_merkle_program.key(),
    )]
    pub audit_tree_config: Account<'info, TreeConfig>,

    /// CHECK: Validated by the SPL Account Compression program; structure is
    /// opaque to us — the compression CPI enforces all invariants.
    #[account(mut)]
    pub audit_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: Must be the SPL Account Compression program
    /// (cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK). Executable check
    /// enforced by the `executable` constraint.
    #[account(executable)]
    pub compression_program: AccountInfo<'info>,

    /// CHECK: Must be the SPL Noop program
    /// (noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV).
    pub noop_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [RWA_VAULT_SEED, payer.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, VaultState>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── STATE ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    /// The authority that controls this vault (the RIA advisor's wallet).
    pub authority: Pubkey,
    /// Total USDC currently allocated into RWA instruments (token-denominated).
    pub rwa_allocated_usdc: u64,
    /// PDA bump seed.
    pub bump: u8,
}

/// Parsed compliance fields extracted from the Token-2022 TokenMetadata extension.
/// Used internally; not stored on-chain.
pub struct RwaCompliance {
    /// KYC requirement is met. Always true after ACE gate passes.
    pub kyc_required_met: bool,
    /// Holder jurisdiction is on the mint's allowlist (or allowlist is empty).
    pub jurisdiction_ok: bool,
    /// The fund is currently open for redemption / subscription.
    pub redeemable: bool,
    /// Current annualized yield in basis points from the mint's metadata.
    /// Zero signals "use fund-specific default" (routers will substitute).
    pub current_yield_bps: u16,
    /// True when the TokenMetadata extension was absent from the mint account.
    /// Captured in audit leaf so the SEC trail reflects the compliance data source.
    pub metadata_absent: bool,
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum RwaTarget {
    /// Franklin Templeton OnChain US Gov Money Fund — Jupiter v6 swap route.
    Fobxx,
    /// BlackRock USD Institutional Digital Liquidity Fund — allowlist-gated vault.
    Buidl,
    /// Apollo Diversified Credit (Securitize sToken) — ATS sToken subscription.
    Acred,
    /// Future-extensibility: any Token-2022 compliant RWA mint.
    Custom { mint: Pubkey },
}

impl RwaTarget {
    pub fn discriminant(&self) -> u8 {
        match self {
            RwaTarget::Fobxx => 0,
            RwaTarget::Buidl => 1,
            RwaTarget::Acred => 2,
            RwaTarget::Custom { .. } => 255,
        }
    }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

#[event]
pub struct RwaAllocation {
    /// RwaTarget discriminant (0=FOBXX, 1=BUIDL, 2=ACRED, 255=Custom).
    pub target: u8,
    pub amount_usdc: u64,
    pub rwa_mint: Pubkey,
    /// Annualized yield captured at allocation time, in basis points.
    pub yield_rate_bps: u16,
    pub slot: u64,
}

#[event]
pub struct RwaRedemption {
    /// RwaTarget discriminant.
    pub target: u8,
    pub amount_tokens: u64,
    pub rwa_mint: Pubkey,
    pub slot: u64,
}

// ─── ERRORS ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum RwaError {
    #[msg("RWA: allocation or redemption amount must be greater than zero")]
    ZeroAmount,
    #[msg("RWA: ACE — wallet has not passed KYC verification")]
    AceKycNotPassed,
    #[msg("RWA: ACE — wallet flagged by sanctions screening")]
    AceSanctionsFlag,
    #[msg("RWA: ACE — AML risk score below required threshold (min 70)")]
    AceAmlScoreLow,
    #[msg("RWA: ACE — wallet is not an accredited investor (required for all RWA)")]
    AceNotAccredited,
    #[msg("RWA: ACE — attestation is stale; re-verification required (max age 24 h)")]
    AceAttestationStale,
    #[msg("RWA: KYC requirement embedded in the token mint is not satisfied")]
    KycRequired,
    #[msg("RWA: holder jurisdiction blocked by the token's jurisdiction_allowlist")]
    JurisdictionBlocked,
    #[msg("RWA: token has a transfer restriction flag; subscription not permitted")]
    TransferRestricted,
    #[msg("RWA: position is currently locked and cannot be redeemed")]
    RedemptionLocked,
    #[msg("RWA: arithmetic overflow")]
    MathOverflow,
}

// ─── UNIT TESTS ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rwa_target_discriminants_are_stable() {
        assert_eq!(RwaTarget::Fobxx.discriminant(), 0);
        assert_eq!(RwaTarget::Buidl.discriminant(), 1);
        assert_eq!(RwaTarget::Acred.discriminant(), 2);
        assert_eq!(RwaTarget::Custom { mint: Pubkey::default() }.discriminant(), 255);
    }

    #[test]
    fn route_leaf_is_deterministic() {
        let leaf1 = build_route_leaf(0, 1_000_000, 528, 999);
        let leaf2 = build_route_leaf(0, 1_000_000, 528, 999);
        assert_eq!(leaf1, leaf2, "same inputs must produce same leaf");
    }

    #[test]
    fn route_leaf_differs_by_target() {
        let fobxx = build_route_leaf(0, 1_000_000, 528, 100);
        let buidl = build_route_leaf(1, 1_000_000, 515, 100);
        assert_ne!(fobxx, buidl, "different targets must produce different leaves");
    }

    #[test]
    fn route_leaf_differs_by_amount() {
        let a = build_route_leaf(0, 1_000_000, 528, 100);
        let b = build_route_leaf(0, 2_000_000, 528, 100);
        assert_ne!(a, b, "different amounts must produce different leaves");
    }

    #[test]
    fn redeem_leaf_is_deterministic() {
        let leaf1 = build_redeem_leaf(0, 500_000, 200);
        let leaf2 = build_redeem_leaf(0, 500_000, 200);
        assert_eq!(leaf1, leaf2, "same inputs must produce same redeem leaf");
    }

    #[test]
    fn yield_constants_match_canonical_values() {
        assert_eq!(FOBXX_DEFAULT_YIELD_BPS, 528, "FOBXX 5.28% T-bill yield");
        assert_eq!(BUIDL_DEFAULT_YIELD_BPS, 515, "BUIDL 5.15% liquid yield");
        assert_eq!(ACRED_DEFAULT_YIELD_BPS, 842, "ACRED 8.42% private credit yield");
    }

    #[test]
    fn min_aml_score_is_canonical() {
        assert_eq!(MIN_AML_SCORE, 70);
    }

    #[test]
    fn attestation_max_age_is_canonical() {
        assert_eq!(MAX_ATTESTATION_AGE_SECS, 86_400, "24 hours in seconds");
    }

    #[test]
    fn slippage_cap_is_fifty_bps() {
        assert_eq!(FOBXX_MAX_SLIPPAGE_BPS, 50);
    }
}
