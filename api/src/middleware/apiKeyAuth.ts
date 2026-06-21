import { Request, Response, NextFunction } from "express";

/**
 * Per-tenant API-key authentication. Each white-label partner (Anchorage, and
 * any future custodian) gets an isolated key so usage, billing (2–5 bps on AUM),
 * and data are partitioned per tenant.
 */
const VALID_KEYS = new Map<string, string>([
  // key → tenant id.  In production these live in a secrets manager, never code.
  [process.env.ANCHORAGE_API_KEY ?? "zk_test_anchorage", "anchorage"],
]);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { tenantId?: string; }
  }
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/v1/health") return next();
  const key = req.header("x-api-key");
  if (!key || !VALID_KEYS.has(key)) {
    res.status(401).json({
      error: "unauthorized",
      message: "Provide a valid x-api-key header. Contact partnerships@zynt.xyz to provision one.",
    });
    return;
  }
  req.tenantId = VALID_KEYS.get(key);
  next();
}
