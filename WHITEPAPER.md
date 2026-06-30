# Zynt Protocol — Whitepaper

**An experimental, post-quantum-first compliance protocol for investment advisors, built on Solana.**

*Version 2.0 · June 2026 · Experimental / pre-audit · Open source · Not an offer of securities*

---

## 0. Read this first — honest status

This is a **design document for an early-stage, experimental system**, not a description of a finished or audited product. To keep it grounded, here is exactly where Zynt stands today:

- ✅ Six on-chain Anchor (Rust) programs — **all compile cleanly**
- ✅ **Full test suite passing: 53/53** against a local validator
- ✅ Real **ML-DSA-44 (FIPS 204)** signature-verification logic, tested natively in Rust (including tampered-signature rejection)
- 🚧 **On-chain** post-quantum verification is **not yet live** — it hits a Solana BPF stack constraint; a zero-knowledge-proof path is in progress and a native-syscall path is planned for when Solana ships one
- 🚧 The **ZKML compliance circuit is a stub** (placeholder), not a trained, verifying model
- ❌ **Not security-audited. Not on mainnet. No users. No live assets.**
- 🛠️ Built by a non-technical founder using AI-assisted development, in public

Everything below describes what Zynt **is designed to be**. Where a capability is aspirational or unbuilt, it is labeled as such.

---

## 1. The problem

Registered investment advisors operate under books-and-records obligations (Investment Advisers Act, Rule 204-2) that require them to preserve an accurate, durable history of their activity. In practice, that history lives in spreadsheets, PDFs, and shared drives — systems that can be edited or reorganized after the fact. When an examiner asks "how do you know this record wasn't altered?", the honest answer is usually "because we say so."

Two pressures make that gap matter more over time:

1. **Enforcement.** Regulators have levied significant penalties for recordkeeping failures, keeping provable records on the industry's radar.
2. **Data lifetime vs. quantum risk.** Compliance records carry multi-year retention requirements. The cryptography protecting long-lived records today is exactly the class most exposed to future quantum attack under a "harvest now, decrypt later" model — the longer a record must stay trustworthy, the more it matters that its integrity survives the arrival of cryptographically relevant quantum computers.

Zynt's thesis: **compliance should be provable, not asserted — and built to stay provable for as long as the record must be kept.**

## 2. Design goals

- **Verifiable, not trusted.** Every advisor action should produce a cryptographic record that the advisor — and, in principle, a regulator — can verify independently.
- **Tamper-evident by construction.** Records live on an append-only, Merkle-committed audit trail; altering history changes the root.
- **Post-quantum from day one.** Signatures use NIST-standardized post-quantum algorithms, designed so the verification backend can be upgraded as the ecosystem matures.
- **Solana-native.** No cross-chain bridges; the whole system settles on one ledger for auditability and speed.

## 3. Architecture

Zynt is composed of six Anchor programs that interact via cross-program invocation (CPI):

| Program | Role |
|---|---|
| `hybrid_vault` | Token-2022 vault: deposits, withdrawals, rebalancing, freeze |
| `regulatory_oracle` | Reads market data (Pyth), gates risk, checks the ZKML proof |
| `audit_merkle` | Append-only audit trail via SPL Account Compression (ConcurrentMerkleTree, depth 20) |
| `ace_adapter` | Pre-trade identity / compliance gate (KYC/AML/accreditation attestation) |
| `rwa_router` | Routes vault capital into tokenized real-world-asset funds (Token-2022) |
| `falcon_verify` | Post-quantum signature verification (ML-DSA / Dilithium family) |

Every state-mutating instruction appends an audit-trail leaf as its final operation, so the immutable record is a structural property of the protocol rather than an optional feature. The frontend is a Next.js dashboard (the "advisor OS") that talks to these programs directly via `@solana/web3.js` — currently a design, not a connected application.

## 4. The compliance model

Zynt separates compliance into two layers:

- **Pre-trade (identity).** Before any value moves, `ace_adapter` validates an attestation covering KYC/AML, sanctions screening, accreditation, jurisdiction, and freshness. This is designed to complement external identity layers (e.g. Chainlink ACE) rather than reinvent them.
- **Post-trade (proof).** `regulatory_oracle` is intended to verify a zero-knowledge proof of an anomaly-detection model's risk score (a ZKML circuit), and `audit_merkle` records the outcome immutably. *The ZKML circuit is currently stubbed; the design target is a verifiable anomaly detector, but no trained, proving model is wired in yet.*

## 5. Post-quantum design

Zynt's signature layer is built around **ML-DSA (FIPS 204)** — the lattice-based scheme NIST standardized (ML-DSA-65 is also known as Dilithium-3) — chosen specifically because it is the standard regulators and standards bodies are steering finance toward, not a bespoke scheme.

**The on-chain constraint, stated honestly.** Full ML-DSA verification cannot currently run inside Solana's BPF virtual machine: key expansion needs roughly 16 KB of working memory through a 4 KB stack frame. The cryptographic logic is real and tested off-chain in Rust; the on-chain program presently performs structural (length) checks only.

**The swappable-backend solution.** To get from "real but off-chain" to "real and on-chain" without rewriting the protocol, the verifier exposes one stable interface with interchangeable backends, selected by on-chain configuration:

1. **Stub** — length checks only; insecure, development-only, blocked on mainnet by design.
2. **ZK proof** — verify the signature off-chain inside a zero-knowledge circuit, submit a succinct proof, and verify only that proof on-chain. *In progress; this is specialist cryptography engineering.*
3. **Native syscall** — call a runtime `sol_mldsa_verify` instruction when Solana ships one (the same track as the Falcon / SIMD-0416 work). *Planned; the cleanest endpoint once available.*

Switching backends is a configuration change plus a client account change — not a protocol rewrite. This lets Zynt ship the architecture now and drop in real on-chain verification when the ZK circuit is sound or the syscall lands.

## 6. Risk parameters

The protocol's risk module is designed around these canonical thresholds (configurable, governance-controlled):

- Maximum drawdown alert: **5%** in any 24-hour epoch
- Anomaly freeze: ZKML risk score **≥ 0.85**
- Leverage cap: **3–5×** on DeFi positions
- Oracle confidence gate: reject prices outside **±2.5%** Pyth confidence
- Privileged actions (freeze, parameter changes, key rotation) require a **4-of-7 multisig** and a post-quantum signature check

## 7. What is real vs. planned

| Capability | Status |
|---|---|
| Six programs compile; 53 tests pass | ✅ Real |
| Immutable Merkle audit trail (structure) | ✅ Implemented |
| Token-2022 vault, RWA routing (structure) | ✅ Implemented |
| ML-DSA verification logic (off-chain) | ✅ Real + tested |
| On-chain post-quantum verification | 🚧 In progress (ZK path) / planned (syscall) |
| ZKML compliance circuit | 🚧 Stubbed |
| Security audit | ❌ Not done |
| Mainnet deployment, users, assets | ❌ None |

## 8. Roadmap (honest)

- **Now:** lock the swappable verifier architecture; build the non-cryptographic parts (dispatch, config, governance, tests); scope the ZK-proof backend's feasibility.
- **Next:** a real ZKML compliance circuit; on-chain ML-DSA via the ZK backend; devnet deployment of all six programs.
- **Then:** independent professional security audit — a prerequisite before any real-asset use, and the point at which specialist cryptography and Solana engineers are essential.
- **Later:** swap to a native post-quantum syscall when Solana provides one; connected advisor-OS frontend.

## 9. Team and resourcing

Zynt is currently an open-source, founder-led experiment. Honest progression of this work — particularly the zero-knowledge cryptography and a security audit — will require specialist engineering help. The technical frontier has been scoped to the point where a Solana/cryptography engineer can be handed a precise problem statement rather than a vague brief.

## 10. Disclaimers

This document is for informational purposes only. It is not financial, legal, tax, or investment advice, and not an offer to sell or a solicitation to buy any security. Forward-looking statements describe design intent and are subject to change. Zynt is experimental, unaudited software provided as-is, with no warranty; it must not be used with real assets. Independent security review is required before any production deployment.

---

*Open source: github.com/yoderyoder/zynt-protocol*
