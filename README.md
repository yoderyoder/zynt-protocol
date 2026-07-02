# Zynt Protocol

An experimental compliance protocol built on Solana, exploring cryptographic
approaches to regulatory audit trails for investment advisors.

> **Status:** Early-stage, work-in-progress. Not security-audited. Not deployed
> to mainnet. No production users. See the [Status section](#status) for a full
> accounting of what is and is not real.

---

## What this is

Zynt Protocol is a research-stage Solana project that experiments with:

- **Immutable audit trails** — every state-mutating instruction appends a leaf to
  a ConcurrentMerkleTree (SPL Account Compression), producing a tamper-evident
  on-chain log compatible with SEC 17a-3/4 recordkeeping principles.
- **Compliance gating** — pre-trade identity checks (KYC, AML, sanctions,
  accreditation, jurisdiction) modeled on Chainlink ACE.
- **Tokenized-asset routing** — routing logic for tokenized money-market funds
  (FOBXX, BUIDL, ACRED) using Token-2022 with associated metadata extensions.
- **Post-quantum signature hooks** — account structures for Dilithium-3 and
  Falcon-512 key management, designed to be wired to a real PQ library once
  Solana's SIMD-0416 lands.
- **ZKML anomaly detection stub** — placeholder CPI flow for an on-chain ZKML
  risk-score callback (circuits are not production-grade; see Status below).

---

## Repository layout

```
programs/               ← six Anchor programs (Rust)
├── ace_adapter/        ← compliance gate (KYC/AML/sanctions/accreditation)
├── audit_merkle/       ← SPL-compressed append-only audit log
├── hybrid_vault/       ← Token-2022 vault with ACE gate + oracle CPI
├── regulatory_oracle/  ← Pyth price consumer + ZKML score callback
├── rwa_router/         ← tokenized-asset routing (FOBXX/BUIDL/ACRED)
└── falcon_verify/      ← PQ signature key-ring management
api/                    ← white-label Compliance API (Express + TypeScript)
research/               ← ZKML circuit package (Python/EZKL, standalone)
interactive/            ← reference React components (read-only context)
CLAUDE.md               ← engineering conventions and build instructions
```

---

## Build and test

**Prerequisites:** Rust 1.78+, Anchor 0.31.x (`avm use 0.31.0`), Solana CLI 1.18+,
Node LTS (20+), pnpm.

```bash
# On-chain programs
cd programs
avm use 0.31.0
anchor build
anchor test                      # runs against localnet; all 61 tests pass

# Compliance API
cd api
pnpm install
ANCHORAGE_API_KEY=zk_test_anchorage pnpm run dev

# ZKML circuit (standalone Python)
cd research/circuit-package
./verify_sample.sh
```

### Test results

All six programs compile cleanly and the full test suite passes:

```
61 passing (60s)
0 failing
```

Suite breakdown:
| Suite | Tests | What it covers |
|---|---|---|
| ace_adapter | 14 | All 6 compliance gates; re-attestation |
| e2e_integration | 12 | Full cross-program flow; 9-leaf audit trail |
| falcon_verify | 7 | Keyring init, ML-DSA-44 verify/rotate, Falcon-512 stub |
| falcon_verify — PQ interface | 8 | `PqVerifierConfig` init, dispatch, mainnet guard, `set_mode` governance |
| phase0 | 10 | Oracle + vault lifecycle; freeze + audit integrity |
| rwa_router | 10 | FOBXX/BUIDL/ACRED alloc/redeem; ACE reject; zero-amount reject |

---

## Devnet deployment

All six programs are live on **Solana devnet** (deployed July 2026):

| Program | Devnet program ID | Explorer |
|---|---|---|
| `audit_merkle` | `86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM` | [view](https://explorer.solana.com/address/86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM?cluster=devnet) |
| `regulatory_oracle` | `EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L` | [view](https://explorer.solana.com/address/EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L?cluster=devnet) |
| `hybrid_vault` | `8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y` | [view](https://explorer.solana.com/address/8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y?cluster=devnet) |
| `ace_adapter` | `5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ` | [view](https://explorer.solana.com/address/5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ?cluster=devnet) |
| `rwa_router` | `6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY` | [view](https://explorer.solana.com/address/6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY?cluster=devnet) |
| `falcon_verify` | `CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR` | [view](https://explorer.solana.com/address/CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR?cluster=devnet) |

Upgrade authority: `HkX2yaGqTuPC2Kc5XHAexRB53YTQtfc1LUu9edArk1o4` (single devnet keypair —
not a multisig; the 4-of-7 requirement is enforced at the program level for privileged
instructions, not by the upgrade authority at this stage).

---

## Status

This project is **experimental and incomplete**. Specifically:

| Component | State |
|---|---|
| All 6 Anchor programs | Compile; 61/61 tests pass on localnet; deployed to devnet |
| Audit trail (Merkle) | Functional — appends real leaves to a real ConcurrentMerkleTree |
| ACE compliance gate | Functional — enforces KYC/AML/sanctions/accreditation rules in tests |
| ML-DSA-44 verification (off-chain) | **Real** — full FIPS 204 verification tested natively in Rust; 7 unit tests pass including tampered-signature rejection |
| On-chain PQ verification | **Stub active** — `PqVerifierConfig` + swappable dispatch deployed; Stub mode performs length checks only; ZK-proof and native-syscall backends are scaffolded but return `ZkNotYetImplemented` / `SyscallUnavailable`; Stub is hard-blocked on mainnet by design |
| Falcon-512 verification | **Not yet** — returns `FalconNotYetSupported`; awaiting SIMD-0416 syscall |
| ZKML anomaly detection | **Stub only** — accepts any 192-byte buffer as a valid "proof"; no real ZK circuit runs on-chain |
| Pyth oracle integration | Placeholder accounts; not connected to live Pyth feeds |
| Mainnet deployment | Not deployed |
| Security audit | Not audited |
| Production users | None |

The crypto stubs exist to validate the overall CPI architecture and audit-trail
plumbing. The next significant milestone is the ZK-proof backend for on-chain ML-DSA
verification (Risc0 / Bonsol path), followed by an independent security audit.

---

## Toolchain (pinned)

| Tool | Version |
|---|---|
| Rust | 1.78+ stable |
| Anchor | 0.31.x |
| Solana CLI | 1.18.26 |
| spl-account-compression | 0.3.x |
| Node | LTS 20+ |

---

## License

Not licensed for production or commercial use in its current form. All code is
provided for research and educational purposes. Conduct an independent security
audit before any deployment handling real assets.
