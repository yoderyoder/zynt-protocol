/**
 * Zynt Compliance API — White-Label Server (Initiative 02)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The cryptographic compliance infrastructure layer that sits *inside* a
 * custodian's RIA platform. Designed Anchorage-first: Anchorage has the
 * federally chartered bank, the custody rails, and (post-Securitize-For-Advisors
 * acquisition) the RIA distribution. What they lack — and what this API provides
 * — is ZKML-verified compliance proofs, immutable Merkle audit trails satisfying
 * SEC 17a-3/4, and post-quantum signatures.
 *
 * Deployable two ways:
 *   1. White-labeled  — "Anchorage Compliance Proof™ powered by Zynt"
 *   2. Independent     — advisors call Zynt directly within existing workflows
 *
 * Commercial model: 2–5 bps on AUM processed through the verify-trade endpoint.
 */

import express, { Request, Response, NextFunction } from "express";
import { verifyTradeHandler } from "./routes/verifyTrade";
import { exportAuditHandler } from "./routes/exportAudit";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { rateLimiter } from "./middleware/rateLimiter";

const app = express();
app.use(express.json({ limit: "256kb" }));

// Every request is authenticated with a per-tenant API key (Anchorage gets one
// tenant; each white-label partner is isolated) and rate-limited.
app.use(apiKeyAuth);
app.use(rateLimiter);

// ─── Health & metadata ──────────────────────────────────────────────────────
app.get("/v1/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "zynt-compliance-api",
    version: "1.0.0",
    chain: "solana-mainnet",
    finality_target_ms: 400,
  });
});

// ─── Core endpoints ─────────────────────────────────────────────────────────

/**
 * POST /v1/compliance/verify-trade
 * Called by the custodian *before* settling any RIA trade. Runs the full Zynt
 * gate (ACE attestation → ZKML risk score → audit-trail append) and returns a
 * proof hash in well under one Alpenglow finality window.
 */
app.post("/v1/compliance/verify-trade", verifyTradeHandler);

/**
 * GET /v1/audit/export
 * Returns an SEC 17a-4-compliant Merkle proof bundle for an advisor over a
 * date range — Dilithium-3-signed, anchored to a Solana slot, independently
 * verifiable against the public on-chain Merkle root.
 */
app.get("/v1/audit/export", exportAuditHandler);

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Errors explain what went wrong and how to fix it, in the API's voice.
  res.status(500).json({
    error: "internal_error",
    message: err.message,
    docs: "https://docs.zynt.xyz/compliance-api/errors",
  });
});

const PORT = process.env.PORT ?? 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Zynt Compliance API listening on :${PORT}`);
});

export default app;
