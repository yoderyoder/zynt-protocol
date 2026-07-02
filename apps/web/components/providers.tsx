"use client";

import { Buffer } from "buffer";

// Polyfill Buffer for @solana/web3.js in browser — runs once on module load
if (typeof globalThis !== "undefined" && !("Buffer" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).Buffer = Buffer;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
