import { PROGRAMS, PROGRAM_KEYS } from "@/lib/constants";

const ROLE_BADGES: Record<string, string> = {
  hybrid_vault: "CORE",
  regulatory_oracle: "CORE",
  audit_merkle: "CORE",
  ace_adapter: "ADAPTER",
  rwa_router: "ADAPTER",
  falcon_verify: "ADAPTER",
};

const BADGE_COLORS: Record<string, string> = {
  CORE: "bg-primary/15 text-primary border-primary/30",
  ADAPTER: "bg-accent/10 text-accent border-accent/20",
};

function truncateId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

export function ProgramsPanel() {
  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-base font-semibold text-text-base">
          Deployed Programs
        </h2>
        <span className="font-mono text-xs text-text-dim">
          Solana Devnet · 6 programs
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-accent">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          LIVE
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PROGRAM_KEYS.map((key) => {
          const p = PROGRAMS[key];
          const badge = ROLE_BADGES[key];
          return (
            <div
              key={key}
              className="group flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-hi"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-text-base">
                  {p.label}
                </h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${BADGE_COLORS[badge]}`}
                  >
                    {badge}
                  </span>
                  <span className="rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    ✓ DEPLOYED
                  </span>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-text-mid">{p.short}</p>

              <div className="mt-auto pt-2 flex items-center justify-between border-t border-border/60">
                <span className="font-mono text-[11px] text-text-dim">
                  {truncateId(p.id)}
                </span>
                <a
                  href={p.explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-primary underline-offset-2 hover:text-accent hover:underline"
                >
                  Explorer ↗
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[11px] text-text-dim">
        CPI order: hybrid_vault → regulatory_oracle → audit_merkle (last).
        Adapters (ace, rwa, falcon) gate into the core trio independently.
      </p>
    </section>
  );
}
