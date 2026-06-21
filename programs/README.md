# Zynt On-Chain Programs

Three Anchor programs implementing Initiatives 01, 03, and 06. They compose with
the core Zynt programs (hybrid_vault, regulatory_oracle, audit_merkle) via CPI.

| Program | Initiative | Purpose |
|---|---|---|
| `ace_adapter`  | 01 | Validates a Chainlink ACE attestation before any trade |
| `rwa_router`   | 03 | Routes vault capital into FOBXX / BUIDL / ACRED |
| `falcon_verify`| 06 | Dual-mode PQ signatures: Dilithium-3 today, Falcon on SIMD-0416 |

## Build

```bash
# from programs/
avm use 0.31.0
anchor build
anchor test --skip-deploy        # localnet
anchor deploy --provider.cluster devnet
```

## Composition (CPI flow per trade)

```
advisor trade
   │
   ├─▶ ace_adapter::validate_before_trade   (Initiative 01 — pre-trade identity)
   │
   ├─▶ falcon_verify::verify_signature      (Initiative 06 — PQ-signed authority)
   │
   ├─▶ regulatory_oracle::verify_anomaly_proof  (ZKML risk gate)
   │
   ├─▶ rwa_router::route_to_rwa  (Initiative 03 — if allocating to FOBXX/BUIDL/ACRED)
   │
   └─▶ audit_merkle::append_audit_entry     (immutable SEC 17a-3/4 trail)
```
