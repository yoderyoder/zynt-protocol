# Zynt Compliance API — White-Label (Initiative 02)

Cryptographic compliance infrastructure that runs **inside** a custodian's RIA
platform. Built Anchorage-first.

## Why Anchorage

In December 2025 Anchorage Digital acquired Securitize For Advisors (which grew
4,500% in 12 months). Anchorage now has the federally chartered bank charter,
the custody rails, and the RIA distribution. What it does **not** have is
ZKML-verified compliance proofs, immutable Merkle audit trails satisfying SEC
17a-3/4, and post-quantum signing. That is exactly this API.

## Deploy modes

1. **White-labeled** — surfaces as "Anchorage Compliance Proof™ powered by Zynt".
2. **Independent** — advisors call Zynt directly inside existing workflows.

## Endpoints

| Method | Path                          | Purpose                                   |
|--------|-------------------------------|-------------------------------------------|
| POST   | `/v1/compliance/verify-trade` | Pre-settlement gate, returns proof hash   |
| GET    | `/v1/audit/export`            | SEC 17a-4 Merkle bundle, Dilithium-3 signed |
| GET    | `/v1/health`                  | Liveness                                  |

## Commercial model

2–5 bps on AUM processed through `verify-trade`. Per-tenant API keys isolate
usage, billing, and data.

## Run locally

```bash
npm install
ANCHORAGE_API_KEY=zk_test_anchorage npm run dev
curl -s localhost:8787/v1/health
```

See `openapi.yaml` for the full contract.
