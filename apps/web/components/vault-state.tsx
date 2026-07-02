"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAMS, RISK_PARAMS, DEVNET_RPC } from "@/lib/constants";

interface ChainStats {
  slot: number;
  epoch: number;
}

export function ProtocolState() {
  const connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [chain, setChain] = useState<ChainStats | null>(null);
  const [programsDeployed, setProgramsDeployed] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);

  const fetchChainState = useCallback(async () => {
    try {
      const [slot, epochInfo] = await Promise.all([
        connection.getSlot("confirmed"),
        connection.getEpochInfo(),
      ]);
      setChain({ slot, epoch: epochInfo.epoch });

      const checks = await Promise.all(
        Object.entries(PROGRAMS).map(async ([key, p]) => {
          const info = await connection.getAccountInfo(new PublicKey(p.id));
          return [key, info?.executable === true] as const;
        })
      );
      setProgramsDeployed(Object.fromEntries(checks));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetchChainState();
    const id = setInterval(() => {
      connection
        .getSlot("confirmed")
        .then((s) => setChain((c) => (c ? { ...c, slot: s } : c)));
    }, 5_000);
    return () => clearInterval(id);
  }, [fetchChainState, connection]);

  const deployedCount = Object.values(programsDeployed).filter(Boolean).length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-base font-semibold text-text-base">
          Protocol State
        </h2>
        <span className="font-mono text-xs text-text-dim">devnet</span>
      </div>

      <div className="flex flex-col gap-3">
        {/* Live chain stats */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            Chain
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Slot"
              value={loading ? "…" : (chain?.slot.toLocaleString() ?? "—")}
              live
            />
            <Stat
              label="Epoch"
              value={loading ? "…" : (chain?.epoch.toLocaleString() ?? "—")}
            />
            <Stat
              label="Programs"
              value={loading ? "…" : `${deployedCount} / 6`}
              ok={!loading && deployedCount === 6}
            />
            <Stat label="Network" value="devnet" />
          </div>
        </div>

        {/* Program deployment map */}
        {!loading && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-dim">
              Program Deployment
            </p>
            <div className="space-y-1.5">
              {Object.entries(PROGRAMS).map(([key, p]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-mono text-xs text-text-mid">
                    {p.label}
                  </span>
                  {programsDeployed[key] ? (
                    <span className="font-mono text-[11px] text-accent">
                      ✓ executable
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-danger">
                      ✗ not found
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risk parameters */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            Canonical Risk Parameters
          </p>
          <div className="space-y-1.5">
            {Object.entries(RISK_PARAMS).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-text-dim">
                  {camelToLabel(key)}
                </span>
                <span className="font-mono text-[11px] text-text-mid">
                  {value}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] text-text-dim/70">
            Enforced on-chain by regulatory_oracle + hybrid_vault.
            Governance-controlled; changes require 4-of-7 multisig + ML-DSA
            signature.
          </p>
        </div>

        {/* Honest status */}
        <div className="rounded-lg border border-warning/20 bg-warning/5 p-4">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-warning/70">
            What is not yet live
          </p>
          <ul className="space-y-1 font-mono text-[11px] text-text-dim">
            <li>🚧 No vaults initialized on devnet — no deposits or state</li>
            <li>🚧 Pyth oracle not connected to live feeds</li>
            <li>🚧 ZKML circuit is a stub (accepts any 192-byte buffer)</li>
            <li>🚧 On-chain ML-DSA is length-check only (Stub mode)</li>
            <li>❌ No security audit — do not use with real assets</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  live,
  ok,
}: {
  label: string;
  value: string;
  live?: boolean;
  ok?: boolean;
}) {
  return (
    <div className="rounded border border-border/60 bg-surface-hi p-2.5">
      <p className="mb-1 font-mono text-[10px] text-text-dim">{label}</p>
      <p
        className={`font-mono text-sm font-semibold ${
          ok === true
            ? "text-accent"
            : ok === false
              ? "text-danger"
              : live
                ? "text-primary"
                : "text-text-base"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function camelToLabel(s: string): string {
  return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
