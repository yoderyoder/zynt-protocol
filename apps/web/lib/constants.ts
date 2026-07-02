export const DEVNET_RPC = "https://api.devnet.solana.com";

export const PROGRAMS = {
  hybrid_vault: {
    id: "8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y",
    label: "Hybrid Vault",
    short: "Core vault. Token-2022 deposits, withdrawals, rebalancing, freeze.",
    role: "Entry point. CPIs into regulatory_oracle and audit_merkle.",
    explorer:
      "https://explorer.solana.com/address/8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y?cluster=devnet",
  },
  regulatory_oracle: {
    id: "EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L",
    label: "Regulatory Oracle",
    short: "Pyth price feeds + ZKML risk-score gate. Freezes on anomaly.",
    role: "Guards trades. Rejects prices outside ±2.5% confidence.",
    explorer:
      "https://explorer.solana.com/address/EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L?cluster=devnet",
  },
  audit_merkle: {
    id: "86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM",
    label: "Audit Merkle",
    short: "SPL-compressed audit trail. Every instruction appends a leaf.",
    role: "Last CPI in every state-mutating instruction. SEC 17a-3/4.",
    explorer:
      "https://explorer.solana.com/address/86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM?cluster=devnet",
  },
  ace_adapter: {
    id: "5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ",
    label: "ACE Adapter",
    short: "Pre-trade compliance gate: KYC, AML, sanctions, accreditation.",
    role: "Blocks trades before hybrid_vault proceeds.",
    explorer:
      "https://explorer.solana.com/address/5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ?cluster=devnet",
  },
  rwa_router: {
    id: "6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY",
    label: "RWA Router",
    short: "Routes capital into tokenized RWA funds (FOBXX / BUIDL / ACRED).",
    role: "Alloc / redeem via Token-2022. Gated by ACE + audit trail.",
    explorer:
      "https://explorer.solana.com/address/6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY?cluster=devnet",
  },
  falcon_verify: {
    id: "CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR",
    label: "Falcon Verify",
    short: "Post-quantum signature verification (ML-DSA-44 / Falcon-512).",
    role: "Swappable backend: Stub → ZK proof (Risc0) → syscall (SIMD TBD).",
    explorer:
      "https://explorer.solana.com/address/CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR?cluster=devnet",
  },
} as const;

export type ProgramKey = keyof typeof PROGRAMS;
export const PROGRAM_KEYS = Object.keys(PROGRAMS) as ProgramKey[];

export const RISK_PARAMS = {
  maxDrawdown: "5 %",
  freezeScore: "≥ 0.85 (ZKML)",
  leverageCap: "3× – 5×",
  oracleConfidence: "± 2.5 % (Pyth)",
  zkmlTargetAuc: "0.961 (achieved)",
  multisig: "4-of-7",
} as const;

export const CPI_CHAIN = ["hybrid_vault", "regulatory_oracle", "audit_merkle"] as const;
