"use client";

import { useEffect, useState } from "react";

type SolanaProvider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey: { toString: () => string };
  }>;
  disconnect: () => Promise<void>;
  publicKey?: { toString: () => string } | null;
  isConnected?: boolean;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    solflare?: SolanaProvider;
  }
}

function getProvider(): SolanaProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.solana ?? window.solflare;
}

export function WalletButton() {
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const provider = getProvider();
    if (provider?.isConnected && provider.publicKey) {
      setPubkey(provider.publicKey.toString());
    }
  }, []);

  const connect = async () => {
    const provider = getProvider();
    if (!provider) {
      alert(
        "Phantom or Solflare wallet extension not detected.\n\nInstall one from phantom.app or solflare.com, then reload."
      );
      return;
    }
    setLoading(true);
    try {
      const res = await provider.connect();
      setPubkey(res.publicKey.toString());
    } catch {
      // user rejected
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    const provider = getProvider();
    if (provider) await provider.disconnect().catch(() => {});
    setPubkey(null);
  };

  if (!mounted) {
    return (
      <button
        disabled
        className="rounded border border-border bg-surface px-3 py-1.5 font-display text-xs font-semibold text-text-dim"
      >
        Connect Wallet
      </button>
    );
  }

  if (pubkey) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-text-dim">
          {pubkey.slice(0, 4)}…{pubkey.slice(-4)}
        </span>
        <button
          onClick={disconnect}
          className="rounded border border-border bg-surface px-3 py-1.5 font-display text-xs font-semibold text-text-mid hover:border-danger hover:text-danger"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="rounded border border-primary/30 bg-primary px-3 py-1.5 font-display text-xs font-semibold text-bg hover:bg-accent disabled:opacity-60"
    >
      {loading ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
