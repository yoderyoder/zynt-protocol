"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import { PROGRAMS, DEVNET_RPC } from "@/lib/constants";

interface StreamEntry extends ConfirmedSignatureInfo {
  age: string;
}

function ageLabel(blockTime: number | null | undefined): string {
  if (!blockTime) return "—";
  const delta = Math.floor(Date.now() / 1000) - blockTime;
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function StatusDot({ err }: { err: unknown }) {
  return err ? (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" title="failed" />
  ) : (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" title="confirmed" />
  );
}

export function ProofStream() {
  const connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const programId = useMemo(() => new PublicKey(PROGRAMS.audit_merkle.id), []);

  const fetchSigs = useCallback(async () => {
    try {
      const sigs = await connection.getSignaturesForAddress(programId, {
        limit: 20,
      });
      const mapped: StreamEntry[] = sigs.map((s) => ({
        ...s,
        age: ageLabel(s.blockTime),
      }));
      setEntries(mapped);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "RPC error");
    } finally {
      setLoading(false);
    }
  }, [connection, programId]);

  useEffect(() => {
    fetchSigs();
    const id = setInterval(fetchSigs, 30_000);
    return () => clearInterval(id);
  }, [fetchSigs]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-base font-semibold text-text-base">
          Audit Proof Stream
        </h2>
        <span className="font-mono text-xs text-text-dim">audit_merkle</span>
        {lastRefresh && (
          <span className="ml-auto font-mono text-[11px] text-text-dim">
            refreshed {ageLabel(Math.floor(lastRefresh.getTime() / 1000))}
          </span>
        )}
      </div>

      <div className="min-h-[280px] rounded-lg border border-border bg-surface">
        {loading && (
          <div className="flex h-full min-h-[280px] items-center justify-center">
            <span className="animate-pulse font-mono text-xs text-text-dim">
              querying devnet…
            </span>
          </div>
        )}

        {error && !loading && (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="font-mono text-xs text-danger">{error}</p>
            <button
              onClick={fetchSigs}
              className="rounded border border-border px-3 py-1 font-mono text-xs text-text-dim hover:border-primary hover:text-primary"
            >
              retry
            </button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="rounded-full border border-border p-3 text-xl opacity-30">
              📋
            </div>
            <p className="font-mono text-xs text-text-dim">
              No audit events recorded yet.
            </p>
            <p className="max-w-xs font-mono text-[11px] text-text-dim/70">
              Events appear when an on-chain instruction calls
              append_audit_entry. The first call also initializes the
              ConcurrentMerkleTree (depth-20).
            </p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="divide-y divide-border overflow-hidden rounded-lg">
            <div className="grid grid-cols-[16px_1fr_80px_60px] gap-2 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              <span />
              <span>Signature</span>
              <span className="text-right">Slot</span>
              <span className="text-right">Age</span>
            </div>
            {entries.map((e) => (
              <div
                key={e.signature}
                className="grid grid-cols-[16px_1fr_80px_60px] items-center gap-2 px-4 py-2.5 text-[11px] transition-colors hover:bg-surface-hi"
              >
                <StatusDot err={e.err} />
                <a
                  href={`https://explorer.solana.com/tx/${e.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-primary hover:text-accent"
                  title={e.signature}
                >
                  {e.signature.slice(0, 8)}…{e.signature.slice(-8)}
                </a>
                <span className="text-right font-mono text-text-dim">
                  {e.slot.toLocaleString()}
                </span>
                <span className="text-right font-mono text-text-dim">
                  {e.age}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="font-mono text-[11px] text-text-dim">
        Live feed · polls every 30 s ·{" "}
        <a
          href={PROGRAMS.audit_merkle.explorer}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-accent"
        >
          View program ↗
        </a>
      </p>
    </section>
  );
}
