import { Request, Response, NextFunction } from "express";

/** Simple in-memory token bucket per tenant. Production: Redis-backed. */
const buckets = new Map<string, { tokens: number; updated: number }>();
const CAPACITY = 1000;      // requests
const REFILL_PER_SEC = 50;  // tokens/sec

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const tenant = req.tenantId ?? "anonymous";
  const now = Date.now();
  const b = buckets.get(tenant) ?? { tokens: CAPACITY, updated: now };
  const elapsedSec = (now - b.updated) / 1000;
  b.tokens = Math.min(CAPACITY, b.tokens + elapsedSec * REFILL_PER_SEC);
  b.updated = now;
  if (b.tokens < 1) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Retry shortly." });
    return;
  }
  b.tokens -= 1;
  buckets.set(tenant, b);
  next();
}
