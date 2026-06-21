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
anchor test --skip-deploy        # runs against localnet; all 53 tests pass

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
53 passing (52s)
0 failing
```

Suite breakdown:
| Suite | Tests | What it covers |
|---|---|---|
| ace_adapter | 14 | All 6 compliance gates; re-attestation |
| e2e_integration | 12 | Full cross-program flow; 9-leaf audit trail |
| falcon_verify | 7 | Keyring init, Dilithium-3 verify/rotate, Falcon-512 stub |
| phase0 | 10 | Oracle + vault lifecycle; freeze + audit integrity |
| rwa_router | 10 | FOBXX/BUIDL/ACRED alloc/redeem; ACE reject; zero-amount reject |

---

## Status

This project is **experimental and incomplete**. Specifically:

| Component | State |
|---|---|
| All 6 Anchor programs | Compile and all tests pass on localnet |
| Audit trail (Merkle) | Functional stub — appends real leaves to a real ConcurrentMerkleTree |
| ACE compliance gate | Functional stub — enforces KYC/AML/sanctions rules in tests |
| Dilithium-3 verification | **Stub only** — length-checks the key/sig buffers but does NOT perform actual cryptographic verification |
| Falcon-512 verification | **Stub only** — immediately returns `FalconNotYetSupported`; awaiting SIMD-0416 |
| ZKML anomaly detection | **Stub only** — accepts any 192-byte buffer as a valid "proof"; no real ZK circuit runs on-chain |
| Pyth oracle integration | Placeholder accounts; not connected to live Pyth feeds |
| Mainnet deployment | Not deployed |
| Security audit | Not audited |
| Production users | None |

The crypto stubs exist to validate the overall CPI architecture and audit-trail
plumbing. Replacing them with real verification libraries is future work.

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
