export function ExperimentalBanner() {
  return (
    <div
      role="alert"
      className="sticky top-0 z-50 w-full border-b border-warning/40 bg-warning/10 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2 text-center">
        <span className="animate-blink text-warning" aria-hidden>⚠</span>
        <span className="font-mono text-xs font-semibold tracking-widest text-warning">
          EXPERIMENTAL&nbsp;·&nbsp;DEVNET ONLY&nbsp;·&nbsp;UNAUDITED&nbsp;·&nbsp;DO NOT USE WITH REAL ASSETS
        </span>
        <span className="animate-blink text-warning" aria-hidden>⚠</span>
      </div>
    </div>
  );
}
