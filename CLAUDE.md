# CLAUDE.md — Zynt Protocol

> This file is read automatically by every Claude Code surface (terminal, VS Code,
> JetBrains, web) and by every subagent. Keep it accurate; it is the single source
> of truth for how this codebase is built.

## What we are building

Zynt Protocol is a **quantum-resistant DeFi advisor OS for SEC-registered RIAs**,
built 100% Solana-native. The product's value proposition is *cryptographic proof
of compliance*: every advisor action generates a ZKML risk proof and an immutable
Merkle audit entry, confirmed on-chain in under 400 ms (Alpenglow finality).

This is a **compliance product that happens to use crypto** — not a crypto project.
Treat every architectural decision as if an SEC examiner will review it, because
eventually one might.

## Toolchain — pinned, do not drift

| Tool | Version | Notes |
|---|---|---|
| Rust | 1.78+ | **stable**, never nightly |
| Anchor | 0.31.x | `avm use 0.31.0` |
| Solana CLI | 1.18.26 | `solana-test-validator` for localnet |
| spl-token-2022 | latest 0.31-compatible | transfer hooks, metadata, confidential ext |
| spl-account-compression | 0.3.x | ConcurrentMerkleTree, **depth 20** |
| pyth-sdk-solana | 0.10.x | price feed consumer |
| EZKL | 0.9.x | ZKML circuit compile + prove |
| Bonsol SDK | 0.2.x | on-chain ZK execution |
| Next.js | 15 (App Router) | frontend in `apps/web` |
| Node | LTS (20+) | required for Anchor CLI + Next.js |
| Package mgr | pnpm + Turborepo | monorepo workspaces |

## Repository map

```
.
├── CLAUDE.md                  ← this file
├── programs/                  ← on-chain Anchor programs
│   ├── Anchor.toml
│   ├── hybrid_vault/          ← CORE · Token-2022 vault (to build)
│   ├── regulatory_oracle/     ← CORE · Pyth + ZKML verifier (to build)
│   ├── audit_merkle/          ← CORE · SPL-compressed audit trail (to build)
│   ├── ace_adapter/           ← Initiative 01 · Chainlink ACE gate (exists)
│   ├── rwa_router/            ← Initiative 03 · FOBXX/BUIDL/ACRED (exists)
│   └── falcon_verify/         ← Initiative 06 · PQ signatures (exists)
├── api/                       ← Initiative 02 · white-label Compliance API (exists)
├── research/                  ← Initiative 05 · ZKML circuit package (exists)
├── sales/                     ← Initiative 04 · non-code, do not touch in builds
├── apps/web/                  ← Next.js 15 dashboard (to build)
└── interactive/               ← reference React artifacts (read-only context)
```

## Build / test / deploy

```bash
# On-chain
cd programs
avm use 0.31.0
anchor build
anchor test --skip-deploy                      # localnet
anchor deploy --provider.cluster devnet

# API
cd api && pnpm install && pnpm run dev          # ANCHORAGE_API_KEY=zk_test_anchorage

# ZK circuit
cd research/circuit-package && ./verify_sample.sh

# Frontend
cd apps/web && pnpm install && pnpm dev
```

## CPI dependency map — READ BEFORE PARALLELIZING

The three **core** programs depend on each other and must be built **sequentially**,
in this order, because each CPIs into the next:

```
hybrid_vault ──CPI──▶ regulatory_oracle ──CPI──▶ (Bonsol ZKML)
      │                        │
      └────────CPI─────────────┴────────▶ audit_merkle  (append leaf — LAST op)
```

The **adapter** programs depend on the core trio's *interfaces* but are independent
of each other, so once the core interfaces are stable they parallelize cleanly:

```
ace_adapter   ──CPI──▶ hybrid_vault   (validate_before_trade, runs FIRST)
falcon_verify ──CPI──▶ hybrid_vault   (verify_signature, privileged instrs)
rwa_router    ──CPI──▶ ace_adapter + audit_merkle
api/          ──reads─▶ all programs via IDL clients
research/     ──standalone (Python/EZKL, no on-chain dependency)
```

**Rule:** build the core trio on the main thread first. Then fan out the adapters,
API, and research as independent agents. Never parallelize the core trio.

## Non-negotiable engineering rules

### Rust / Anchor
- **Every** state-mutating instruction calls `append_audit_entry` (audit_merkle CPI)
  as its **last** operation. No exceptions.
- Use **checked arithmetic** (`checked_add`, `checked_mul`) — never raw operators.
- Validate accounts with `require!(cond, ErrorCode::X)` **before** any mutation.
- **No `unsafe {}`** anywhere in program code.
- Verify a **Dilithium-3 / Falcon signature** (falcon_verify CPI) before any
  privileged instruction: `freeze_account`, `update_risk_params`, `rotate_signing_key`,
  upgrade authority.
- `emit!(EventName { slot, ... })` for **every** state change.
- Use `#[error_code]` for all errors — **never `panic!()`**.
- PDAs include a discriminator in their seeds.
- **No PII** in on-chain account state, ever.

### Risk parameters (canonical values)
- Max drawdown: **5%** (`max_drawdown_bps = 500`)
- Freeze score threshold: **0.85** (`freeze_score_bps = 8500`)
- Leverage cap: **3×–5×** (`leverage_min = 300`, `leverage_max = 500`)
- Pyth oracle confidence gate: **±2.5%** (reject if `confidence/price ≥ 0.025`)
- ZKML target AUC: **0.94** (achieved 0.961)

### TypeScript / Next.js
- Handle `TransactionError` with a user-facing message on every Anchor call.
- Use `connection.getLatestBlockhash('finalized')` for Alpenglow guarantees.
- Exponential backoff on RPC rate limits (max 5 retries).
- Never store private keys; always `signTransaction` via the wallet adapter.

### Security
- **No hardcoded program IDs** — read from `declare_id!` / env / a constants module.
- Multisig (**4-of-7**) required for: upgrade authority, `freeze_all`, `update_risk_params`.
- All admin access via WebAuthn; mTLS for internal services; least-privilege IAM.
- Secrets in a secrets manager, never in code. Rotate keys quarterly.

## Conventions
- One concern per PR. Every PR description states which audit CPI it touches.
- Tests live in `tests/` (TS) and `#[cfg(test)]` modules (Rust). New instruction →
  new test, no exceptions.
- Run `cargo clippy -- -D warnings`, `cargo audit`, and `anchor test` before any
  "done" claim.
- Do **not** touch `sales/` or `interactive/` during code builds — they are
  collateral and reference material, not build targets.

## Definition of done (per program)
1. `anchor build` clean, `cargo clippy -- -D warnings` clean.
2. `anchor test --skip-deploy` passes, including the audit-trail integrity test.
3. Every state mutation emits an event and appends an audit leaf.
4. Privileged instructions gated by a PQ signature check.
5. Deployed to devnet; program ID recorded in `programs/Anchor.toml`.
