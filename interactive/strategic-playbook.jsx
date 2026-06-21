import { useState } from "react";

// ── DATA ─────────────────────────────────────────────────────────────────────

const INITIATIVES = [
  {
    id: "ace",
    num: "01",
    code: "ACE-LAYER",
    title: "Chainlink ACE Integration",
    subtitle: "Position Zynt as the post-trade layer to ACE's pre-trade identity",
    status: "BUILD NOW",
    statusColor: "#00C2CC",
    phase: "Phase 2 — Day 31–60",
    priority: "CRITICAL",
    priorityColor: "#FF4D6A",
    icon: "🔗",
    impact: "Eliminates competitive threat. Makes both products more valuable.",
    effort: "Medium — 1 Anchor adapter program + SDK wrapper",
    owner: "CTO",
    deadline: "Day 45",
    revenue: "Unlocks enterprise custodian pipeline",
    summary: "Chainlink ACE (launched June 30, 2025) handles KYC/AML identity allowlisting — the pre-trade question 'is this wallet allowed to transact?' Zynt handles everything after: ZKML risk verification, immutable audit trails, post-quantum signing, and compliance reporting. These are complementary layers, not competitors. Positioning Zynt as ACE-compatible creates a 2-layer institutional stack that neither can build alone.",
    architecture: `// The Two-Layer Institutional Compliance Stack
//
// LAYER 1 — Chainlink ACE (pre-trade identity)
//   • KYC/AML status attestation
//   • Sanctions screening (OFAC)
//   • Accreditation verification
//   • Cross-chain identity (GLEIF LEI)
//
// LAYER 2 — Zynt Protocol (post-trade compliance)
//   • ZKML anomaly detection (0.961 AUC)
//   • SPL-compressed Merkle audit trail (SEC 17a-3/4)
//   • Dilithium-3 / Falcon post-quantum signing
//   • Risk gating: drawdown, leverage, oracle confidence
//   • PLONK rebalancing proofs
//
// Integration point: ace_adapter.rs consumes ACE
// attestation accounts before Zynt executes any trade

// ── ace_adapter.rs ────────────────────────────────────
use anchor_lang::prelude::*;
use chainlink_solana as chainlink;

#[account]
pub struct AceAttestation {
    pub wallet:      Pubkey,
    pub kyc_passed:  bool,
    pub aml_score:   u8,        // 0-100, ACE-provided
    pub sanctions_ok:bool,
    pub accredited:  bool,
    pub verified_at: i64,       // Unix timestamp
    pub jurisdiction:[u8; 4],   // ISO 3166-1 alpha-2
    pub ace_proof:   [u8; 64],  // ACE-signed attestation
}

#[derive(Accounts)]
pub struct ValidateAce<'info> {
    pub ace_attestation: Account<'info, AceAttestation>,
    pub payer: Signer<'info>,
}

pub fn validate_ace_before_trade(
    ctx: Context<ValidateAce>,
    min_aml_score: u8,
) -> Result<()> {
    let att = &ctx.accounts.ace_attestation;

    require!(att.kyc_passed,    ZyntError::KycNotPassed);
    require!(att.sanctions_ok,  ZyntError::SanctionsFlag);
    require!(att.accredited,    ZyntError::NotAccredited);
    require!(
        att.aml_score >= min_aml_score,
        ZyntError::AmlScoreBelowThreshold
    );

    // Verify attestation is fresh (< 24h)
    let now = Clock::get()?.unix_timestamp;
    require!(
        now - att.verified_at < 86_400,
        ZyntError::AceAttestationStale
    );

    // ACE passed — Zynt's risk layer takes over
    emit!(AceValidatedEvent {
        wallet: att.wallet,
        aml_score: att.aml_score,
        slot: Clock::get()?.slot,
    });
    Ok(())
}`,
    steps: [
      { id: "a1", label: "Sign up for Chainlink ACE early access", detail: "chain.link/automated-compliance-engine — request institutional access, mention Zynt is Solana-native compliance layer", done: false, tag: "BD" },
      { id: "a2", label: "Draft ACE partnership term sheet", detail: "Position as integration partner, not white-label customer. Key ask: ACE on Solana mainnet access + shared marketing rights", done: false, tag: "BD" },
      { id: "a3", label: "Build ace_adapter.rs Anchor program", detail: "Consumes ACE AceAttestation account. Validates KYC/AML/sanctions/accreditation before Zynt hybrid_vault executes any instruction", done: false, tag: "ENG" },
      { id: "a4", label: "Wire ace_adapter CPI into hybrid_vault", detail: "Add validate_ace_before_trade() CPI at start of execute_swap, rebalance, deposit instructions. Log ACE attestation slot in audit trail", done: false, tag: "ENG" },
      { id: "a5", label: "Write ACE + Zynt joint positioning brief", detail: "One-page for custodian conversations: 'ACE covers who. Zynt covers what, when, and proof-of-compliance.' Give to custodian BD contacts", done: false, tag: "MKTG" },
      { id: "a6", label: "Publish ACE-compatible badge on zynt.xyz", detail: "Add 'ACE-Compatible' to website credential strip. Add technical integration doc to /docs/ace-integration", done: false, tag: "MKTG" },
    ],
    links: [
      { label: "Chainlink ACE launch announcement", url: "https://prnewswire.com/news-releases/chainlink-launches-automated-compliance-engine..." },
      { label: "ACE technical overview", url: "https://blog.chain.link/automated-compliance-engine-technical-overview/" },
      { label: "Aave Horizon adopts Chainlink ACE", url: "https://x.com/chainlink/status/1985436823888544138" },
    ],
  },
  {
    id: "anchorage",
    num: "02",
    code: "ANCHORAGE-API",
    title: "Anchorage White-Label Compliance API",
    subtitle: "Become the cryptographic compliance infrastructure inside Anchorage's RIA platform",
    status: "HIGHEST PRIORITY",
    statusColor: "#FF4D6A",
    phase: "Phase 2–3 — Day 45–90",
    priority: "CRITICAL",
    priorityColor: "#FF4D6A",
    icon: "🏦",
    impact: "Single relationship unlocks Anchorage's entire RIA distribution network",
    effort: "High — enterprise sales cycle 90–120 days. Technical: Compliance API v1",
    owner: "CEO",
    deadline: "Day 60 — first meeting. Day 90 — NDA signed",
    revenue: "$50K–$150K/yr white-label API contract",
    summary: "In December 2025, Anchorage Digital acquired Securitize For Advisors — a crypto wealth management platform for RIAs that grew 4,500% in 12 months. Anchorage explicitly said it wants 'white-labeled experiences' and 'flexibility in how advisors engage.' They have the federally chartered bank charter, the custody infrastructure, and now the RIA distribution. What they don't have: ZKML-verified compliance proofs, immutable Merkle audit trails satisfying SEC 17a-3/4, and post-quantum signatures. That is Zynt's Compliance API, and it is the most important enterprise conversation you will have.",
    architecture: `// Zynt Compliance API — White-Label Architecture
// Designed for custodian integration (Anchorage-first)

// ── REST + Webhook Interface ──────────────────────────

// POST /v1/compliance/verify-trade
// Called by Anchorage before settling any RIA trade
{
  "wallet":      "AnchorageVaultPDA...",
  "instruction": "SWAP",
  "asset_pair":  ["SOL", "USDC"],
  "notional_usd": 2400000,
  "advisor_id":  "J.Harrington.CFA",
  "ace_attestation": "chainlink_ace_proof_hash"
}
// Response (< 400ms, Alpenglow-bound):
{
  "approved": true,
  "zkml_score": 0.724,
  "proof_hash": "8kj3f...a92b",
  "merkle_root": "Qm4...f8e",
  "slot": 312481944,
  "finality_ms": 312,
  "audit_entry_id": "AUD-18291"
}

// ── Compliance Report Endpoint ────────────────────────

// GET /v1/audit/export?advisor=J.Harrington&from=2025-01-01
// Returns SEC 17a-4 compliant Merkle proof bundle:
{
  "entries": [...],         // All audit events
  "merkle_root": "Qm4...",  // Current tree root
  "merkle_proof": [...],    // Proof path per entry
  "dilithium3_sig": "...",  // Post-quantum signed
  "solana_slot": 312481944, // Timestamp anchor
  "verified": true
}

// ── White-Label Config ────────────────────────────────
// Anchorage deploys Zynt's compliance layer as:
// "Anchorage Compliance Proof™ powered by Zynt"
// — or fully white-labeled under Anchorage brand
// — Zynt receives 2–5 bps on AUM processed`,
    steps: [
      { id: "b1", label: "Get warm introduction to Anchorage Digital BD team", detail: "Target: Nathan McCauley (CEO) or head of RIA partnerships. Route via: design-partner RIA intro, Solana Foundation, or angel investor network", done: false, tag: "CEO" },
      { id: "b2", label: "Prepare Anchorage-specific value brief", detail: "'Anchorage has the charter and the distribution. Zynt has the cryptographic compliance infrastructure. Together: the only regulated RIA crypto platform with mathematical proof of compliance.' Max 1 page.", done: false, tag: "CEO" },
      { id: "b3", label: "Sign mutual NDA with Anchorage", detail: "Required before sharing technical architecture or pricing. Standard NDA is fine — focus on closing it fast, not negotiating terms", done: false, tag: "LEGAL" },
      { id: "b4", label: "Build Compliance API v1 — REST interface", detail: "POST /v1/compliance/verify-trade returns ZK proof hash + Merkle entry ID in < 400ms. GET /v1/audit/export returns SEC 17a-4 compliant bundle. OpenAPI spec published.", done: false, tag: "ENG" },
      { id: "b5", label: "Build Compliance API v1 — white-label config", detail: "Anchorage can deploy as 'Anchorage Compliance Proof™' with their branding. Zynt is the infrastructure layer — visible in docs, invisible in UI if they want", done: false, tag: "ENG" },
      { id: "b6", label: "Negotiate Compliance API term sheet", detail: "Key terms: 2–5 bps on AUM processed, non-exclusive, data portability, no auto-termination on acquisition. See regulatory roadmap Section 3 red lines.", done: false, tag: "LEGAL" },
    ],
    links: [
      { label: "Anchorage acquires Securitize For Advisors (Dec 2025)", url: "https://www.coindesk.com/business/2025/12/15/anchorage-digital-buys-securitize-s-ria-platform..." },
      { label: "InvestmentNews: Schwab entering crypto custody", url: "https://www.investmentnews.com/ria-news/crypto-custodian-anchorage-digital-acquires-securitizes-ria-unit/263613" },
    ],
  },
  {
    id: "rwa",
    num: "03",
    code: "RWA-PIPELINE",
    title: "FOBXX / BUIDL / ACRED Native Integrations",
    subtitle: "Turn the three largest Solana RWA instruments into one-click allocations",
    status: "BUILD NEXT",
    statusColor: "#B8A0FF",
    phase: "Phase 2 — Day 35–55",
    priority: "HIGH",
    priorityColor: "#FFB340",
    icon: "🏛",
    impact: "$594M+ FOBXX AUM becomes Zynt yield pipeline. Product differentiation + distribution.",
    effort: "Medium — Token-2022 metadata reader + 3 CPI adapters",
    owner: "CTO",
    deadline: "Day 55",
    revenue: "2–5 bps on RWA AUM routed through Zynt vaults",
    summary: "Franklin Templeton's FOBXX fund manages $594M in tokenized U.S. government securities live on Solana. BlackRock BUIDL runs on Solana among 8 chains. Apollo ACRED (launched May 2025 via Securitize on Solana) is the first native RWA lending market. These are not competitors — they are the instruments Zynt's yield module routes capital into. An RIA advisor using Zynt should be able to allocate idle USDC to institutional T-bills in a single instruction. That's a product differentiator ('we connect you to the instruments BlackRock chose') and a distribution argument ('Franklin Templeton is a distribution partner whether they know it yet or not').",
    architecture: `// RWA Integration Layer — Token-2022 Readers
// FOBXX, BUIDL, ACRED all use Token-2022 with
// compliance metadata embedded in the mint.

// ── rwa_router.rs ─────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum RwaTarget {
    Fobxx,   // Franklin Templeton FOBXX on Solana
    Buidl,   // BlackRock BUIDL (Solana deployment)
    Acred,   // Apollo ACRED via Securitize sToken
    Custom { mint: Pubkey },
}

#[derive(Accounts)]
pub struct RouteToRwa<'info> {
    pub vault:        Account<'info, VaultState>,
    pub rwa_mint:     InterfaceAccount<'info, Mint>,  // Token-2022
    pub vault_ata:    InterfaceAccount<'info, TokenAccount>,
    pub rwa_ata:      InterfaceAccount<'info, TokenAccount>,
    pub authority:    Signer<'info>,
    // ACE attestation required for accredited asset access
    pub ace_att:      Account<'info, AceAttestation>,
    pub token_program:Interface<'info, TokenInterface>,
}

pub fn route_to_rwa(
    ctx: Context<RouteToRwa>,
    target: RwaTarget,
    amount_usdc: u64,
) -> Result<()> {
    // 1. Verify ACE attestation (accredited investor check)
    require!(ctx.accounts.ace_att.accredited, ZyntError::NotAccredited);

    // 2. Read Token-2022 metadata for compliance rules
    //    FOBXX embeds: transfer_restrictions, kyc_required,
    //    jurisdiction_allowlist in metadata extension
    let compliance = read_token22_metadata(&ctx.accounts.rwa_mint)?;
    require!(compliance.jurisdiction_ok, ZyntError::JurisdictionBlocked);

    // 3. Execute transfer to RWA position
    let swap_accounts = match target {
        RwaTarget::Fobxx => route_via_jupiter_fobxx(...),
        RwaTarget::Buidl => route_via_buidl_vault(...),
        RwaTarget::Acred => route_via_securitize_stoken(...),
        RwaTarget::Custom { mint } => route_custom(mint, ...),
    };

    // 4. Append audit entry with RWA metadata
    emit!(RwaAllocationEvent {
        target: target.clone(),
        amount_usdc,
        rwa_mint: ctx.accounts.rwa_mint.key(),
        yield_rate_bps: compliance.current_yield_bps,
        slot: Clock::get()?.slot,
    });

    Ok(())
}`,
    steps: [
      { id: "c1", label: "Map Token-2022 metadata schemas for FOBXX, BUIDL, ACRED", detail: "Each fund embeds different compliance fields. Read transfer_hook, metadata, and permanent_delegate extension data. Document the schema for each.", done: false, tag: "ENG" },
      { id: "c2", label: "Build rwa_router.rs Anchor program", detail: "RwaTarget enum + route_to_rwa instruction. ACE attestation check required for accredited asset access. Reads Token-2022 compliance metadata before transfer.", done: false, tag: "ENG" },
      { id: "c3", label: "Implement FOBXX adapter (highest priority — $594M live)", detail: "Franklin Templeton FOBXX on Solana. Route via Jupiter swap or direct FOBXX redemption mechanism. Embed current T-bill yield in audit entry.", done: false, tag: "ENG" },
      { id: "c4", label: "Implement BUIDL adapter", detail: "BlackRock BUIDL Solana deployment. Check BUIDL's allowlist mechanism — accredited investor transfer restriction via Token-2022. Daily yield accrual tracking.", done: false, tag: "ENG" },
      { id: "c5", label: "Implement ACRED adapter (Securitize sToken)", detail: "Apollo ACRED via Securitize on Solana. Uses Securitize's proprietary sToken vault. Coordinate with Securitize API for redemption.", done: false, tag: "ENG" },
      { id: "c6", label: "Build YieldDashboard RWA allocation UI", detail: "One-click 'Allocate to FOBXX/BUIDL/ACRED' buttons with live yield display. Show current rate, liquidity, compliance status, min investment.", done: false, tag: "ENG" },
      { id: "c7", label: "Add 'Powered by FOBXX / BUIDL / ACRED' logos to website", detail: "These are distribution validation signals. Franklin Templeton and BlackRock chose Solana — Zynt connects advisors to them. This is product endorsement by association.", done: false, tag: "MKTG" },
    ],
    links: [
      { label: "FOBXX $594M live on Solana (Feb 2025)", url: "https://www.solulab.com/solana-rwa-tokenization-crypto-market/" },
      { label: "ACRED: Apollo + Securitize native RWA on Solana (May 2025)", url: "https://messari.io/report/state-of-solana-real-world-assets" },
      { label: "Securitize Token-2022 sToken architecture (Breakpoint 2025)", url: "https://solanacompass.com/learn/breakpoint-25/tokenization-where-solanas-tokenization-push-stands..." },
    ],
  },
  {
    id: "sec",
    num: "04",
    code: "SEC-SALES",
    title: "SEC Enforcement as Sales Motion",
    subtitle: "$63M in RIA fines is your warm lead list. Use it.",
    status: "START TODAY",
    statusColor: "#FF4D6A",
    phase: "Ongoing — immediate",
    priority: "HIGH",
    priorityColor: "#FFB340",
    icon: "⚖️",
    impact: "Every RIA compliance officer who read that headline is a warm lead",
    effort: "Low — sales collateral and outreach. No engineering required.",
    owner: "CEO",
    deadline: "Week 1 — collateral live. Week 3 — first 10 outreaches sent",
    revenue: "Direct path to $1,200–$4,800/mo SaaS seats",
    summary: "In January 2025, the SEC fined 12 firms more than $63M for recordkeeping failures — specifically off-channel communications and failure to maintain proper records. The average settlement was $5.25M per firm. Your sales motion is not 'here's a cool blockchain product.' It is: 'The SEC just fined 12 firms $63M for the exact compliance gap Zynt closes. Your next exam cycle is in 18 months. We can give you a cryptographic proof you were compliant — one that a regulator can independently verify — for $1,500/month.' That is a 3,500× ROI on the cost of an enforcement action. Every RIA compliance officer reading that headline is a warm lead.",
    architecture: `// Sales Collateral Assets Needed (no code)
// Priority order:

// ASSET 1: "The $63M Problem" one-page sell sheet
// ─────────────────────────────────────────────────
// Headline: "The SEC fined 12 firms $63M for recordkeeping.
//            Your next exam is in 18 months."
// Body:     What they failed (off-channel comms, missing logs)
//           What Zynt provides (immutable Merkle proof, ≤400ms)
//           What it costs ($1,500/mo vs $5.25M avg settlement)
// CTA:      "Request a compliance audit demo"

// ASSET 2: Cold outreach email sequence (5-touch)
// ─────────────────────────────────────────────────
// Touch 1 (Day 1):
//   Subject: "Re: January SEC recordkeeping fines"
//   Body: "Your [firm] manages [AUM]. The 12 firms
//           fined last month managed similar books.
//           Zynt generates cryptographic proof of
//           your compliance — not a PDF, math.
//           15 minutes?"
//
// Touch 2 (Day 4): Share the Merkle proof demo
// Touch 3 (Day 8): Case study — what a ZKML proof looks like
// Touch 4 (Day 14): "exam season is coming" angle
// Touch 5 (Day 21): Breakup email with one-pager attached

// ASSET 3: Conference speaking deck (NSCP / COMPLY)
// ─────────────────────────────────────────────────
// Title: "Cryptographic Proof of Compliance:
//          What On-Chain Audit Trails Mean for RIAs"
// Frame: Technical + regulatory, not sales
// CTA:   Book a demo at the booth

// ASSET 4: LinkedIn content calendar (12 weeks)
// ─────────────────────────────────────────────────
// Week 1: "What the $63M SEC fine actually means"
// Week 2: "What a Merkle proof looks like vs a PDF"
// Week 3: "Why your risk score is a black box"
// Week 4: "Alpenglow ≤400ms — why this changes compliance"
// ...targeting: RIA CCOs, compliance officers, BD heads`,
    steps: [
      { id: "d1", label: "Write 'The $63M Problem' sell sheet", detail: "One page. Lead with the enforcement headline. Show what they failed. Show what Zynt proves. Show the math: $1,500/mo vs $5.25M avg settlement. Use in all outreach.", done: false, tag: "MKTG" },
      { id: "d2", label: "Build target list: 500 largest US RIAs by AUM", detail: "Source: Investment Adviser Public Disclosure (IAPD) database. Filter: AUM > $100M, registered in CA/NY/TX/FL/IL. Export CCO names and emails. 500 contacts.", done: false, tag: "BD" },
      { id: "d3", label: "Set up Apollo/HubSpot CRM + 5-touch email sequence", detail: "Configure automated sequence. Touch 1 references the fine. Touch 2 sends the Merkle proof demo. Track opens. Call anyone who opens twice.", done: false, tag: "BD" },
      { id: "d4", label: "Apply to speak at NSCP Annual Conference", detail: "National Society of Compliance Professionals. Deadline varies — apply now. Proposed title: 'Cryptographic Proof of Compliance: A Technical Introduction for RIA CCOs'. Non-sales, educational.", done: false, tag: "BD" },
      { id: "d5", label: "Apply to speak at COMPLY 2026", detail: "Top compliance technology conference. Educational proposal: 'On-Chain Audit Trails and the Future of SEC Recordkeeping'. Build brand with the exact audience before selling to them.", done: false, tag: "BD" },
      { id: "d6", label: "Draft LinkedIn content calendar — 12 weeks", detail: "CEO publishes 1 post/week. Week 1: the $63M fine breakdown. Week 2: what a Merkle proof actually shows. Week 3: black-box risk scores. Week 4: Alpenglow and compliance. No product pitches — education only.", done: false, tag: "CEO" },
      { id: "d7", label: "Build live compliance demo: 'Audit your own trail'", detail: "Public demo at demo.zynt.xyz. Takes a simulated trade. Shows the ZKML proof generation, Merkle leaf append, and downloadable SEC 17a-4 bundle. Let CCOs experience it before they book a call.", done: false, tag: "ENG" },
    ],
    links: [
      { label: "SEC recordkeeping enforcement — 12 firms, $63M (Jan 2025)", url: "https://smartasset.com/advisor-resources/compliance-trends" },
      { label: "SEC enforcement against RIAs up 34% in 2024", url: "https://www.investmentnews.com/glossary/best-ria-compliance-software-solutions/262147" },
    ],
  },
  {
    id: "zkml",
    num: "05",
    code: "OPEN-RESEARCH",
    title: "Publish ZKML Circuit as Open Research",
    subtitle: "Make the regulatory claim independently verifiable — then let academia cite you",
    status: "SCHEDULE",
    statusColor: "#B8A0FF",
    phase: "Phase 3 — Day 61–75",
    priority: "MEDIUM-HIGH",
    priorityColor: "#B8A0FF",
    icon: "🔬",
    impact: "SEC visibility, academic co-authorship, independently verifiable compliance claim",
    effort: "Low-Medium — clean existing circuit artifacts + write 8-page technical paper",
    owner: "CTO + ZK Advisor",
    deadline: "Day 75 — arXiv preprint submitted",
    revenue: "Indirect: regulatory trust, inbound enterprise deals, academic talent pipeline",
    summary: "Academic researchers at ICME, Kudelski Security, and others are already studying ZKMLOps frameworks for financial risk auditing compliance. Zynt's anomaly detection circuit achieving 0.961 AUC — exceeding the 0.94 target — is a publishable result. Publishing the circuit, the verification key, and the AUC results as an open research artifact accomplishes two things: (1) the regulatory claim becomes independently verifiable, which is the product's entire value proposition made real, and (2) Zynt becomes the reference implementation of on-chain ML compliance before any competitor has working circuits. SEC staff who read arXiv (and some do) will know Zynt exists before the first custodian conversation.",
    architecture: `// Publication Package — What to Release

// ── ARTIFACT 1: Circuit Files ─────────────────────────
// anomaly_detector.onnx       — trained model
// anomaly_detector.ezkl       — compiled circuit
// settings.json               — KZG SRS parameters
// vk_anomaly_v2.bin           — verification key (PUBLIC)
// pk_anomaly_v2.bin           — proving key (keep private)
// sample_proof.json           — example 4.8KB PLONK proof
// verify_sample.sh            — one-line verification script

// ── ARTIFACT 2: arXiv Preprint (target: 8 pages) ─────
// Title: "ZKMLOps for On-Chain Financial Compliance:
//          Verifiable Anomaly Detection at 0.961 AUC
//          on Solana with SPL Account Compression Audit Trails"
//
// Sections:
// 1. Introduction — the RIA compliance verification gap
// 2. Related Work — EZKL, Bonsol, ZKMLOps (cite arxiv 2510.26576)
// 3. System Architecture — circuit + Anchor integration
// 4. Anomaly Detection Model — IsolationForest + MLP, features
// 5. Proof Generation & Verification — timing, size benchmarks
// 6. Audit Trail — SPL compression Merkle scheme
// 7. Evaluation — AUC 0.961, proof time 6.2s, 4.8KB, 312ms finality
// 8. Discussion — SEC 17a-3/4 implications, future work (Falcon)
//
// Co-authors: CTO + ZK Advisor (EZKL team credit)
// Submit to: arXiv cs.CR (Cryptography and Security)
// Target: also accepted to IEEE S&P or CCS workshop

// ── ARTIFACT 3: GitHub Repository ────────────────────
// github.com/zynt-protocol/zkml-compliance-circuits
// README: what the circuit proves, how to verify, AUC results
// CI: GitHub Actions runs verify_sample.sh on every PR
// License: Apache 2.0 (open source the verifier, not the prover)

// ── ARTIFACT 4: Immunefi Bug Bounty Expansion ─────────
// After publishing: add vk_anomaly_v2.bin to scope
// Bounty: $10K for valid attack on verification soundness
// Frame: "We're so confident in the proof system we're
//          paying you to try to break it"`,
    steps: [
      { id: "e1", label: "Clean and document the circuit artifact package", detail: "anomaly_detector.onnx, .ezkl, settings.json, vk_anomaly_v2.bin, sample_proof.json, verify_sample.sh. Everything needed for independent verification. No code changes — just packaging.", done: false, tag: "ENG" },
      { id: "e2", label: "Create github.com/zynt-protocol/zkml-compliance-circuits repo", detail: "Public repo. Apache 2.0 license. README explains what the circuit proves, the AUC results, and how to run verify_sample.sh. Pin to Zynt org profile.", done: false, tag: "ENG" },
      { id: "e3", label: "Write 8-page arXiv preprint with ZK Advisor co-author", detail: "Title TBD. 8 pages including results tables. ZK Advisor from EZKL team as co-author — this is why the advisor relationship is valuable. Submit to cs.CR category.", done: false, tag: "RESEARCH" },
      { id: "e4", label: "Submit to IEEE S&P 2026 Workshop or Financial Cryptography", detail: "Target: Workshop on Privacy in the Electronic Society (WPES) or Financial Cryptography 2026. Peer review adds credibility for SEC conversations.", done: false, tag: "RESEARCH" },
      { id: "e5", label: "Publish verification key on zynt.xyz/verify", detail: "Public page where anyone can paste a proof hash and verify against the live on-chain verification key. This IS the product: 'compliance proven by math, verified by anyone.'", done: false, tag: "ENG" },
      { id: "e6", label: "Send preprint to SEC Division of Investment Management", detail: "One-paragraph cover email: 'We have built an on-chain compliance verification system for SEC-registered RIAs. The enclosed preprint describes how a regulator can independently verify compliance proofs.' Attach PDF.", done: false, tag: "CEO" },
    ],
    links: [
      { label: "ZKMLOps for financial risk auditing (arXiv 2510.26576)", url: "https://arxiv.org/pdf/2510.26576" },
      { label: "EZKL benchmarks and framework comparison", url: "https://blog.ezkl.xyz/post/benchmarks/" },
      { label: "State of ZKML 2025 (ICME)", url: "https://blog.icme.io/the-definitive-guide-to-zkml-2025/" },
    ],
  },
  {
    id: "falcon",
    num: "06",
    code: "FALCON-PIVOT",
    title: "Falcon Signature Migration",
    subtitle: "When SIMD-0416 ships, Zynt becomes the first RIA compliance product with native Falcon",
    status: "MONITOR",
    statusColor: "#5A7A98",
    phase: "Phase 3+ — Day 75–90 prep. Execute on SIMD-0416 ship.",
    priority: "MEDIUM",
    priorityColor: "#5A7A98",
    icon: "🦅",
    impact: "First-mover: native Falcon on Solana. Smaller sigs = lower tx costs + higher throughput.",
    effort: "Medium-High — signature scheme migration requires careful key management rollover",
    owner: "CTO",
    deadline: "SIMD-0416 ship date (monitor weekly). Migration plan ready by Day 90.",
    revenue: "Technical moat: 80× smaller signatures vs Dilithium-3 = more txs per block",
    summary: "Both Anza and Firedancer/Jump Crypto independently identified Falcon as the optimal post-quantum signature scheme for Solana — specifically because Falcon signatures are 897 bytes vs Dilithium-3's 2,420 bytes, a 2.7× size advantage that matters enormously at Solana's throughput. SIMD-0416 proposes adding a Falcon verification syscall to Solana's runtime. When it ships, Zynt should migrate from Dilithium-3 to Falcon, becoming the first RIA compliance product with native Falcon integration. In the meantime, Dilithium-3 ships today — Zynt is already ahead of every competitor. The preparation work is: watch SIMD-0416, build the migration scaffolding now, and execute fast when the syscall lands.",
    architecture: `// Falcon Migration Plan
// Current: Dilithium-3 (2,420 byte sig, production today)
// Target:  Falcon-512 (897 byte sig, pending SIMD-0416)
//
// Size comparison:
//   Ed25519:     64 bytes   (vulnerable to Shor's algorithm)
//   Dilithium-3: 2,420 bytes (NIST ML-DSA, production today)
//   Falcon-512:  897 bytes  (2.7× smaller than Dilithium-3)
//   HAWK:        ~500 bytes (research stage, not standardized)

// ── SIMD-0416 Monitoring Script ───────────────────────
// Run weekly to check PR status:
//
// curl -s https://api.github.com/repos/solana-labs/\\
//   solana-improvement-documents/pulls \\
//   | jq '.[] | select(.title | contains("falcon") or
//                       contains("SIMD-0416")) | {title, state, updated_at}'

// ── Migration Scaffolding (build now, activate later) ─

// 1. falcon_verify.rs — dual-mode signature verifier
pub fn verify_signature(
    sig_type: SigType,
    sig: &[u8],
    msg: &[u8],
    pk: &[u8],
) -> Result<bool> {
    match sig_type {
        SigType::Dilithium3 => {
            // Current: uses libsodium shim
            verify_dilithium3(sig, msg, pk)
        },
        SigType::Falcon512 => {
            // Future: uses SIMD-0416 syscall
            // sol_falcon512_verify(sig, msg, pk)
            // Uncomment when SIMD-0416 ships
            Err(ZyntError::FalconNotYetSupported)
        },
    }
}

// 2. Key rotation instruction (add to hybrid_vault.rs)
pub fn rotate_signing_key(
    ctx: Context<RotateKey>,
    new_key_type: SigType,
    new_public_key: Vec<u8>,
    dilithium3_authorization: [u8; 2420], // Current key authorizes rotation
) -> Result<()> {
    verify_dilithium3(
        &dilithium3_authorization,
        &new_public_key,
        &ctx.accounts.current_public_key.data
    )?;
    ctx.accounts.vault_state.signing_key = new_public_key;
    ctx.accounts.vault_state.key_type = new_key_type;
    emit!(KeyRotationEvent { new_type: new_key_type, slot: Clock::get()?.slot });
    Ok(())
}

// 3. Transaction cost comparison (why this matters)
//    Dilithium-3: 2,420 bytes × $0.000005/byte ≈ $0.0000121 extra
//    Falcon-512:    897 bytes × $0.000005/byte ≈ $0.0000045 extra
//    At 18,291 proofs/day: saves ~$0.124/day → $45/year
//    At 1,000 RIAs × 50 txs/day: saves $22,640/year in fees
//    More importantly: fits more txs per block → higher throughput`,
    steps: [
      { id: "f1", label: "Set up SIMD-0416 monitoring — weekly check", detail: "Subscribe to github.com/solana-labs/solana-improvement-documents. Set up GitHub notification for any PR touching 'falcon' or 'SIMD-0416'. Check weekly.", done: false, tag: "CTO" },
      { id: "f2", label: "Build dual-mode signature verifier (Dilithium-3 + Falcon stub)", detail: "falcon_verify.rs with SigType enum. Dilithium-3 path active. Falcon path returns FalconNotYetSupported error. Migration-ready from day one.", done: false, tag: "ENG" },
      { id: "f3", label: "Build key rotation instruction in hybrid_vault.rs", detail: "rotate_signing_key() instruction. Current Dilithium-3 key authorizes rotation to Falcon key. Emits KeyRotationEvent with new key type. Required for migration.", done: false, tag: "ENG" },
      { id: "f4", label: "Write Falcon migration runbook (internal doc)", detail: "Step-by-step: when SIMD-0416 ships, how to: generate Falcon keys, rotate all existing Dilithium-3 keys, update website and docs, publish migration announcement. Keep updated as SIMD progresses.", done: false, tag: "CTO" },
      { id: "f5", label: "Monitor Firedancer Falcon implementation for reference", detail: "Jump Crypto is implementing Falcon in Firedancer (shipping 2026). Their implementation is the reference. Watch their GitHub. When they merge Falcon support, SIMD-0416 is close.", done: false, tag: "CTO" },
      { id: "f6", label: "Prepare 'Zynt ships Falcon' announcement materials", detail: "Draft press release + technical blog post now. 'Zynt is the first RIA compliance product with native Falcon signatures on Solana.' Fill in the date when SIMD ships. Have it ready to publish within 24h of SIMD-0416 activation.", done: false, tag: "MKTG" },
    ],
    links: [
      { label: "Solana quantum migration paths (Jump Crypto)", url: "https://jumpcrypto.com/resources/quantum-migration-paths-for-solana" },
      { label: "Solana's post-quantum roadmap — Falcon chosen (Helius)", url: "https://www.helius.dev/blog/solana-post-quantum-cryptography" },
      { label: "5 quantum-proof blockchain projects 2026", url: "https://witanworld.com/article/2026/01/23/5-quantum-proof-blockchain-projects-2026/" },
    ],
  },
];

const TAG_COLORS = {
  ENG:      { bg: "#071E38", text: "#00C2CC", border: "#0E2540" },
  BD:       { bg: "#1A1200", text: "#FFB340", border: "#3A2A00" },
  CEO:      { bg: "#0D1200", text: "#00FF94", border: "#1A2A00" },
  LEGAL:    { bg: "#1A0A24", text: "#B8A0FF", border: "#2A1040" },
  MKTG:     { bg: "#1A0A14", text: "#FF4D6A", border: "#3A1024" },
  RESEARCH: { bg: "#071428", text: "#60A5FA", border: "#0E2040" },
  CTO:      { bg: "#071E38", text: "#00C2CC", border: "#0E2540" },
};

// ── COMPONENT ─────────────────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500&family=Inter:wght@400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --void:#040D1C; --surf:#05101F; --card:#071528; --card2:#071e38;
    --border:#0E2540; --border2:#162E50; --teal:#00C2CC; --teal-dim:#006E78;
    --green:#00FF94; --purple:#B8A0FF; --amber:#FFB340; --red:#FF4D6A;
    --blue:#60A5FA; --text:#F0F4F8; --muted:#5A7A98; --muted2:#3A5570;
    --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif; --display:'Space Grotesk',sans-serif;
  }
  body{background:var(--void);color:var(--text);font-family:var(--sans);font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased;}
  ::-webkit-scrollbar{width:4px;height:4px;} ::-webkit-scrollbar-track{background:var(--void);} ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px;}

  .app{display:flex;flex-direction:column;min-height:100vh;background:var(--void);}

  /* topbar */
  .topbar{background:#030C18;border-bottom:1px solid var(--border);padding:0 20px;height:52px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:100;}
  .topbar-logo{font-family:var(--display);font-size:17px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;}
  .teal-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 6px var(--teal);animation:pulse 2s ease-in-out infinite;}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.75);}}
  .topbar-sep{width:1px;height:20px;background:var(--border);}
  .topbar-meta{font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.08em;}
  .topbar-progress{margin-left:auto;display:flex;align-items:center;gap:10px;}
  .progress-bar{width:120px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;}
  .progress-fill{height:100%;background:var(--teal);border-radius:2px;transition:width .3s ease;}
  .progress-label{font-family:var(--mono);font-size:10px;color:var(--teal);}

  /* sidebar + main */
  .layout{display:flex;flex:1;min-height:0;}
  .sidebar{width:240px;flex-shrink:0;background:#030C18;border-right:1px solid var(--border);padding:16px 0;overflow-y:auto;position:sticky;top:52px;height:calc(100vh - 52px);}
  .sidebar-section-label{padding:8px 16px 6px;font-family:var(--mono);font-size:9px;color:var(--muted2);letter-spacing:.12em;text-transform:uppercase;}
  .sidebar-item{padding:8px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .1s;border-left:2px solid transparent;}
  .sidebar-item:hover{background:rgba(0,194,204,.05);}
  .sidebar-item.active{background:rgba(0,194,204,.08);border-left-color:var(--teal);}
  .sidebar-icon{font-size:14px;width:20px;text-align:center;flex-shrink:0;}
  .sidebar-text{font-size:12px;font-weight:500;line-height:1.3;color:var(--muted);}
  .sidebar-item.active .sidebar-text{color:var(--text);}
  .sidebar-status{margin-left:auto;font-family:var(--mono);font-size:8px;padding:2px 6px;border-radius:1px;font-weight:600;letter-spacing:.04em;flex-shrink:0;}
  .sidebar-check-count{font-family:var(--mono);font-size:9px;color:var(--muted2);margin-left:auto;}

  /* main */
  .main{flex:1;overflow-y:auto;padding:28px;}

  /* initiative header */
  .init-header{margin-bottom:28px;}
  .init-eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
  .init-num{font-family:var(--mono);font-size:11px;color:var(--muted2);letter-spacing:.08em;}
  .status-pill{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;padding:3px 10px;border-radius:2px;border:1px solid;}
  .phase-tag{font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.04em;}
  .init-title{font-family:var(--display);font-size:clamp(22px,3vw,30px);font-weight:700;letter-spacing:-.02em;line-height:1.15;margin-bottom:8px;}
  .init-subtitle{font-size:14px;color:var(--muted);line-height:1.6;}

  /* meta cards */
  .meta-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:28px;}
  .meta-card{background:var(--surf);border:1px solid var(--border);border-radius:2px;padding:14px;position:relative;overflow:hidden;}
  .meta-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
  .meta-label{font-family:var(--mono);font-size:8.5px;color:var(--muted2);letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;}
  .meta-val{font-size:12.5px;font-weight:500;line-height:1.4;color:var(--text);}

  /* summary */
  .summary-card{background:var(--surf);border:1px solid var(--border);border-radius:2px;padding:20px;margin-bottom:20px;}
  .summary-label{font-family:var(--mono);font-size:9px;color:var(--teal);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}
  .summary-text{font-size:13.5px;color:var(--muted);line-height:1.75;}
  .summary-text strong{color:var(--text);font-weight:500;}

  /* two-col */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
  @media(max-width:900px){.two-col{grid-template-columns:1fr;}}

  /* tasks */
  .tasks-card{background:var(--surf);border:1px solid var(--border);border-radius:2px;overflow:hidden;}
  .tasks-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
  .tasks-label{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;}
  .tasks-progress{font-family:var(--mono);font-size:9px;color:var(--teal);}
  .task-row{display:flex;align-items:flex-start;gap:10px;padding:11px 16px;border-bottom:1px solid rgba(14,37,64,.5);cursor:pointer;transition:background .1s;}
  .task-row:last-child{border-bottom:none;}
  .task-row:hover{background:rgba(14,37,64,.3);}
  .task-check{width:16px;height:16px;border-radius:2px;border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;transition:all .15s;}
  .task-check.done{background:var(--green);border-color:var(--green);}
  .task-check.done::after{content:'✓';font-size:10px;color:var(--void);font-weight:800;}
  .task-body{flex:1;min-width:0;}
  .task-label{font-size:12.5px;font-weight:500;line-height:1.4;margin-bottom:3px;}
  .task-label.done{color:var(--muted2);text-decoration:line-through;}
  .task-detail{font-size:11px;color:var(--muted2);line-height:1.5;}
  .task-meta{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-direction:column;align-items:flex-end;}
  .tag{font-family:var(--mono);font-size:8.5px;font-weight:600;padding:2px 7px;border-radius:1px;border:1px solid;letter-spacing:.04em;white-space:nowrap;}

  /* code */
  .code-card{background:#020B14;border:1px solid var(--border);border-radius:2px;overflow:hidden;}
  .code-header{padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
  .code-label{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;}
  .code-body{padding:16px;overflow-x:auto;}
  .code-body pre{font-family:var(--mono);font-size:11.5px;line-height:1.75;color:#5A8AA8;white-space:pre;}
  .code-body .cm-comment{color:#2A4A5E;}
  .code-body .cm-keyword{color:var(--teal);}
  .code-body .cm-fn{color:var(--purple);}
  .code-body .cm-str{color:var(--green);}
  .code-body .cm-num{color:var(--amber);}
  .copy-btn{font-family:var(--mono);font-size:9px;color:var(--muted);background:transparent;border:1px solid var(--border);padding:3px 10px;border-radius:1px;cursor:pointer;transition:all .15s;letter-spacing:.04em;}
  .copy-btn:hover{color:var(--teal);border-color:var(--teal);}

  /* links */
  .links-card{background:var(--surf);border:1px solid var(--border);border-radius:2px;padding:16px;}
  .links-label{font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;}
  .link-item{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(14,37,64,.4);font-size:12px;}
  .link-item:last-child{border-bottom:none;}
  .link-item a{color:var(--teal);text-decoration:none;flex:1;}
  .link-item a:hover{text-decoration:underline;}
  .link-arrow{color:var(--muted2);flex-shrink:0;font-size:10px;}

  /* section header */
  .sec-head{font-family:var(--mono);font-size:9px;color:var(--teal);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);}

  /* overview dashboard */
  .overview-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:28px;}
  @media(max-width:700px){.overview-grid{grid-template-columns:1fr 1fr;}}
  .ov-card{background:var(--surf);border:1px solid var(--border);border-radius:2px;padding:16px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden;}
  .ov-card:hover{border-color:var(--border2);background:var(--card);}
  .ov-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
  .ov-num{font-family:var(--mono);font-size:9px;color:var(--muted2);letter-spacing:.1em;margin-bottom:6px;}
  .ov-title{font-family:var(--display);font-size:14px;font-weight:700;margin-bottom:4px;line-height:1.3;}
  .ov-subtitle{font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:10px;}
  .ov-meta{display:flex;align-items:center;justify-content:space-between;}
  .ov-progress-wrap{flex:1;margin-right:12px;}
  .ov-progress-bar{height:3px;background:var(--border);border-radius:1px;overflow:hidden;margin-top:4px;}
  .ov-progress-fill{height:100%;border-radius:1px;transition:width .4s ease;}
  .ov-progress-pct{font-family:var(--mono);font-size:9px;color:var(--muted2);}

  /* total progress */
  .total-bar{background:var(--surf);border:1px solid var(--border);border-radius:2px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:16px;}
  .total-label{font-family:var(--mono);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;}
  .total-progress{flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;}
  .total-fill{height:100%;background:linear-gradient(90deg,var(--teal),var(--green));border-radius:3px;transition:width .5s ease;}
  .total-pct{font-family:var(--display);font-size:18px;font-weight:700;color:var(--teal);white-space:nowrap;}
  .total-sub{font-family:var(--mono);font-size:9px;color:var(--muted);white-space:nowrap;}
`;

// ── Syntax highlight (very lightweight) ──────────────────────────────────────
function colorCode(code) {
  return code
    .replace(/\/\/.+/g, m => `<span class="cm-comment">${m}</span>`)
    .replace(/\b(pub|fn|let|use|match|impl|struct|enum|require!|Ok|Err|emit!|async|await|const|type|mod|extern|crate|self|super|true|false|None|Some)\b/g, m => `<span class="cm-keyword">${m}</span>`)
    .replace(/"([^"]*)"/g, (m, g) => `<span class="cm-str">"${g}"</span>`)
    .replace(/\b(\d+[\d_]*)\b/g, m => `<span class="cm-num">${m}</span>`);
}

export default function StrategicPlaybook() {
  const [activeId, setActiveId] = useState("overview");
  const [tasks, setTasks] = useState(() => {
    const all = {};
    INITIATIVES.forEach(ini => ini.steps.forEach(s => { all[s.id] = s.done; }));
    return all;
  });
  const [copied, setCopied] = useState(false);

  const toggleTask = (id) => setTasks(p => ({ ...p, [id]: !p[id] }));

  // Progress calculations
  const initProgress = (ini) => {
    const total = ini.steps.length;
    const done = ini.steps.filter(s => tasks[s.id]).length;
    return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
  };
  const totalDone = INITIATIVES.reduce((a, ini) => a + ini.steps.filter(s => tasks[s.id]).length, 0);
  const totalSteps = INITIATIVES.reduce((a, ini) => a + ini.steps.length, 0);
  const totalPct = Math.round(totalDone / totalSteps * 100);

  const copyCode = async (code) => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const active = INITIATIVES.find(i => i.id === activeId);

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* Topbar */}
        <div className="topbar">
          <div className="topbar-logo">
            <span className="teal-dot" />
            ZYNT
          </div>
          <div className="topbar-sep" />
          <div className="topbar-meta">Strategic Initiatives Playbook</div>
          <div className="topbar-sep" />
          <div className="topbar-meta" style={{ color: "var(--muted2)" }}>6 Initiatives · {totalSteps} Tasks</div>
          <div className="topbar-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${totalPct}%` }} />
            </div>
            <span className="progress-label">{totalPct}% complete</span>
          </div>
        </div>

        <div className="layout">
          {/* Sidebar */}
          <div className="sidebar">
            <div className="sidebar-section-label">Navigation</div>

            <div
              className={`sidebar-item${activeId === "overview" ? " active" : ""}`}
              onClick={() => setActiveId("overview")}
            >
              <span className="sidebar-icon">⬡</span>
              <span className="sidebar-text">Overview</span>
              <span className="sidebar-check-count" style={{ color: "var(--teal)", fontSize: 9 }}>{totalDone}/{totalSteps}</span>
            </div>

            <div className="sidebar-section-label" style={{ marginTop: 12 }}>Initiatives</div>

            {INITIATIVES.map(ini => {
              const { done, total, pct } = initProgress(ini);
              return (
                <div
                  key={ini.id}
                  className={`sidebar-item${activeId === ini.id ? " active" : ""}`}
                  onClick={() => setActiveId(ini.id)}
                >
                  <span className="sidebar-icon">{ini.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sidebar-text" style={{ marginBottom: 3 }}>{ini.code}</div>
                    <div style={{ height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: ini.statusColor, borderRadius: 1, transition: "width .3s" }} />
                    </div>
                  </div>
                  <span className="sidebar-check-count">{done}/{total}</span>
                </div>
              );
            })}
          </div>

          {/* Main content */}
          <div className="main">

            {/* OVERVIEW ─────────────────────────────────────── */}
            {activeId === "overview" && (
              <div>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--teal)", letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 10 }}>
                    Strategic Playbook
                  </div>
                  <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(22px,3vw,32px)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.15, marginBottom: 8 }}>
                    Six initiatives to pull<br />
                    <span style={{ color: "var(--teal)" }}>further ahead.</span>
                  </h1>
                  <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, maxWidth: 560 }}>
                    Derived from competitive research across the live market landscape. Each initiative addresses a specific gap, partnership opportunity, or technical upgrade — ordered by impact and urgency.
                  </p>
                </div>

                <div className="total-bar">
                  <span className="total-label">Overall Progress</span>
                  <div className="total-progress">
                    <div className="total-fill" style={{ width: `${totalPct}%` }} />
                  </div>
                  <span className="total-pct">{totalPct}%</span>
                  <span className="total-sub">{totalDone} / {totalSteps} tasks</span>
                </div>

                <div className="overview-grid">
                  {INITIATIVES.map(ini => {
                    const { done, total, pct } = initProgress(ini);
                    return (
                      <div
                        key={ini.id}
                        className="ov-card"
                        onClick={() => setActiveId(ini.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: ini.statusColor }} />
                        <div className="ov-num">{ini.num} · {ini.code}</div>
                        <div className="ov-title">{ini.icon} {ini.title}</div>
                        <div className="ov-subtitle">{ini.subtitle}</div>
                        <div className="ov-meta">
                          <div className="ov-progress-wrap">
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted2)", fontFamily: "var(--mono)", marginBottom: 3 }}>
                              <span>{ini.phase}</span>
                              <span>{done}/{total}</span>
                            </div>
                            <div className="ov-progress-bar">
                              <div className="ov-progress-fill" style={{ width: `${pct}%`, background: ini.statusColor }} />
                            </div>
                          </div>
                          <span style={{
                            fontFamily: "var(--mono)", fontSize: 8, fontWeight: 700,
                            padding: "2px 8px", borderRadius: 1,
                            color: ini.statusColor, border: `1px solid ${ini.statusColor}`,
                            background: `${ini.statusColor}10`, letterSpacing: ".04em", whiteSpace: "nowrap",
                            marginLeft: 10,
                          }}>
                            {ini.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Priority matrix */}
                <div style={{ marginTop: 8 }}>
                  <div className="sec-head">Priority Matrix</div>
                  <div style={{ background: "var(--surf)", border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: "var(--void)", borderBottom: "1px solid var(--border)", padding: "10px 16px" }}>
                      {["Initiative", "Priority", "Owner", "Deadline"].map(h => (
                        <span key={h} style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted2)", letterSpacing: ".1em", textTransform: "uppercase" }}>{h}</span>
                      ))}
                    </div>
                    {INITIATIVES.map((ini, i) => (
                      <div
                        key={ini.id}
                        onClick={() => setActiveId(ini.id)}
                        style={{
                          display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                          padding: "12px 16px", cursor: "pointer",
                          borderBottom: i < INITIATIVES.length - 1 ? "1px solid rgba(14,37,64,.5)" : "none",
                          transition: "background .1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(14,37,64,.3)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14 }}>{ini.icon}</span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{ini.title}</div>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted2)", marginTop: 2 }}>{ini.code}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <span style={{
                            fontFamily: "var(--mono)", fontSize: 8.5, fontWeight: 700,
                            padding: "2px 8px", borderRadius: 1,
                            color: ini.priorityColor, border: `1px solid ${ini.priorityColor}`,
                            background: `${ini.priorityColor}12`, letterSpacing: ".04em",
                          }}>
                            {ini.priority}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center" }}>{ini.owner}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--amber)", display: "flex", alignItems: "center" }}>{ini.deadline.split(" — ")[0]}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* INITIATIVE DETAIL ──────────────────────────── */}
            {active && (
              <div>
                {/* Header */}
                <div className="init-header">
                  <div className="init-eyebrow">
                    <span className="init-num">{active.num}</span>
                    <span className="topbar-sep" style={{ height: 12 }} />
                    <span className="status-pill" style={{
                      color: active.statusColor,
                      borderColor: active.statusColor,
                      background: `${active.statusColor}12`,
                    }}>
                      {active.status}
                    </span>
                    <span className="phase-tag">{active.phase}</span>
                  </div>
                  <h2 className="init-title">{active.icon} {active.title}</h2>
                  <p className="init-subtitle">{active.subtitle}</p>
                </div>

                {/* Meta cards */}
                <div className="meta-row">
                  {[
                    { label: "Impact", val: active.impact, color: "var(--green)" },
                    { label: "Effort", val: active.effort, color: "var(--amber)" },
                    { label: "Owner", val: active.owner, color: "var(--teal)" },
                    { label: "Deadline", val: active.deadline, color: "var(--purple)" },
                  ].map((m, i) => (
                    <div key={i} className="meta-card" style={{ "--mc": m.color }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: m.color }} />
                      <div className="meta-label">{m.label}</div>
                      <div className="meta-val" style={{ color: m.color }}>{m.val}</div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div className="summary-card" style={{ marginBottom: 16 }}>
                  <div className="summary-label">Summary</div>
                  <p className="summary-text">
                    {active.summary.split(/\*\*(.*?)\*\*/g).map((part, i) =>
                      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                    )}
                  </p>
                </div>

                {/* Revenue signal */}
                <div style={{
                  background: `${active.statusColor}08`, border: `1px solid ${active.statusColor}30`,
                  borderRadius: 2, padding: "12px 16px", marginBottom: 20,
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <span style={{ fontSize: 16 }}>💰</span>
                  <div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: active.statusColor, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 3 }}>
                      Revenue Signal
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{active.revenue}</div>
                  </div>
                </div>

                <div className="two-col">
                  {/* Tasks */}
                  <div>
                    <div className="sec-head">
                      Action Steps
                    </div>
                    <div className="tasks-card">
                      <div className="tasks-header">
                        <span className="tasks-label">Tasks</span>
                        <span className="tasks-progress">
                          {initProgress(active).done}/{initProgress(active).total} complete
                          {" "}· {initProgress(active).pct}%
                        </span>
                      </div>
                      {active.steps.map(step => {
                        const done = tasks[step.id];
                        const tagStyle = TAG_COLORS[step.tag] || TAG_COLORS.ENG;
                        return (
                          <div key={step.id} className="task-row" onClick={() => toggleTask(step.id)}>
                            <div className={`task-check${done ? " done" : ""}`} />
                            <div className="task-body">
                              <div className={`task-label${done ? " done" : ""}`}>{step.label}</div>
                              <div className="task-detail">{step.detail}</div>
                            </div>
                            <div className="task-meta">
                              <span className="tag" style={{
                                color: tagStyle.text,
                                background: tagStyle.bg,
                                borderColor: tagStyle.border,
                              }}>{step.tag}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Links */}
                    {active.links.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div className="sec-head">Source Links</div>
                        <div className="links-card">
                          {active.links.map((link, i) => (
                            <div key={i} className="link-item">
                              <span style={{ color: "var(--muted2)", fontSize: 11 }}>↗</span>
                              <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Code */}
                  <div>
                    <div className="sec-head">
                      Technical Implementation
                    </div>
                    <div className="code-card">
                      <div className="code-header">
                        <span className="code-label">
                          {active.id === "sec" ? "Sales Assets" : active.id === "zkml" ? "Publication Package" : active.id === "falcon" ? "Migration Plan" : "Anchor / Rust"}
                        </span>
                        <button className="copy-btn" onClick={() => copyCode(active.architecture)}>
                          {copied ? "✓ Copied" : "Copy"}
                        </button>
                      </div>
                      <div className="code-body">
                        <pre dangerouslySetInnerHTML={{ __html: colorCode(active.architecture) }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Nav between initiatives */}
                <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 20, borderTop: "1px solid var(--border)" }}>
                  <div>
                    {INITIATIVES.findIndex(i => i.id === activeId) > 0 && (
                      <button
                        onClick={() => setActiveId(INITIATIVES[INITIATIVES.findIndex(i => i.id === activeId) - 1].id)}
                        style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 10, padding: "6px 14px", borderRadius: 2, cursor: "pointer", letterSpacing: ".06em" }}
                      >
                        ← Previous
                      </button>
                    )}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted2)" }}>
                    {INITIATIVES.findIndex(i => i.id === activeId) + 1} of {INITIATIVES.length}
                  </div>
                  <div>
                    {INITIATIVES.findIndex(i => i.id === activeId) < INITIATIVES.length - 1 && (
                      <button
                        onClick={() => setActiveId(INITIATIVES[INITIATIVES.findIndex(i => i.id === activeId) + 1].id)}
                        style={{ background: "var(--teal)", border: "none", color: "var(--void)", fontFamily: "var(--mono)", fontSize: 10, padding: "6px 14px", borderRadius: 2, cursor: "pointer", fontWeight: 700, letterSpacing: ".06em" }}
                      >
                        Next →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
