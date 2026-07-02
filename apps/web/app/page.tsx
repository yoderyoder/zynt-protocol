import { WalletButton } from "@/components/wallet-button";
import { ProgramsPanel } from "@/components/programs-panel";
import { ProofStream } from "@/components/proof-stream";
import { ProtocolState } from "@/components/vault-state";

export default function Home() {
  return (
    <main className="min-h-screen bg-bg">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="border-b border-border bg-surface/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold tracking-tight text-primary">
                ZYNT
              </span>
              <span className="font-display text-lg font-light text-text-mid">
                PROTOCOL
              </span>
            </div>
            <p className="font-mono text-[11px] text-text-dim">
              Compliance, proven by math.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
              DEVNET
            </span>
            <a
              href="https://github.com/yoderyoder/zynt-protocol"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-text-dim hover:text-primary"
            >
              GitHub ↗
            </a>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* ── Hero tagline ────────────────────────────────────── */}
      <div className="border-b border-border/40 bg-gradient-to-b from-surface/30 to-transparent px-6 py-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="font-display text-2xl font-semibold text-text-base sm:text-3xl">
            Quantum-Resistant Compliance OS
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-mid">
            Every advisor action generates an immutable Merkle audit entry and a
            post-quantum signature check, confirmed on Solana devnet. Read-only
            view — no transactions beyond wallet connect.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 font-mono text-[11px]">
            <Chip color="accent">61 / 61 tests passing</Chip>
            <Chip color="primary">6 programs on devnet</Chip>
            <Chip color="text-dim">ML-DSA-44 (FIPS 204)</Chip>
            <Chip color="text-dim">SPL Account Compression depth-20</Chip>
            <Chip color="warning">Stub mode · not audited</Chip>
          </div>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <ProgramsPanel />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <ProofStream />
          <ProtocolState />
        </div>

        {/* Footer */}
        <footer className="border-t border-border/40 pb-4 pt-6 font-mono text-[11px] text-text-dim">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Zynt Protocol · Experimental · Devnet · Not security-audited ·
              Not for real assets
            </span>
            <div className="flex gap-4">
              <a
                href="https://github.com/yoderyoder/zynt-protocol/blob/main/WHITEPAPER.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                Whitepaper ↗
              </a>
              <a
                href="https://github.com/yoderyoder/zynt-protocol"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                Source ↗
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

function Chip({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "accent" | "primary" | "warning" | "text-dim";
}) {
  const classes: Record<string, string> = {
    accent: "border-accent/20 bg-accent/10 text-accent",
    primary: "border-primary/20 bg-primary/10 text-primary",
    warning: "border-warning/20 bg-warning/10 text-warning",
    "text-dim": "border-border bg-surface text-text-dim",
  };
  return (
    <span
      className={`rounded border px-2 py-0.5 ${classes[color] ?? classes["text-dim"]}`}
    >
      {children}
    </span>
  );
}
