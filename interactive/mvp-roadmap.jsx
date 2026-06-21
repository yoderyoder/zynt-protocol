import { useState, useEffect, useRef } from "react";

// ─── DATA ─────────────────────────────────────────────────────────────────────

const PHASES = [
  {
    id: "p1",
    label: "Phase 1",
    title: "Core Chain Infrastructure",
    days: "Day 1–30",
    color: "#00C2CC",
    dimColor: "#003d42",
    goal: "Anchor programs compile, deploy to devnet, and pass integration tests. Zero front-end.",
    toolchain: ["Rust 1.78+", "Anchor 0.31", "Solana CLI 1.18", "Cursor IDE", "Claude Code"],
  },
  {
    id: "p2",
    label: "Phase 2",
    title: "ZK + Oracle Integration",
    days: "Day 31–60",
    color: "#A78BFA",
    dimColor: "#2d1f5e",
    goal: "ZKML circuits prove compliance on-chain. Pyth feeds gate risk. SPL compression audit trail live.",
    toolchain: ["EZKL 0.9", "Bonsol SDK", "Pyth SDK", "spl-account-compression", "Anchor CPI"],
  },
  {
    id: "p3",
    label: "Phase 3",
    title: "Product & Testnet Launch",
    days: "Day 61–90",
    color: "#34D399",
    dimColor: "#0a3d28",
    goal: "Next.js 15 dashboard live on Vercel. Design partners onboarded to Solana testnet. First ZK audit proof.",
    toolchain: ["Next.js 15 App Router", "Vercel", "Phantom Wallet", "Jupiter SDK", "Kamino SDK"],
  },
];

const SPRINTS = {
  p1: [
    {
      week: "W1",
      title: "Repo + Anchor scaffold",
      tasks: [
        { id: "t1", label: "Init monorepo with pnpm workspaces + Turborepo", cmd: "pnpm create turbo@latest zynt-protocol", done: false },
        { id: "t2", label: "anchor init hybrid_vault — Token-2022 vault program skeleton", cmd: "anchor init hybrid_vault --template=vault", done: false },
        { id: "t3", label: "anchor init regulatory_oracle — Pyth consumer + ZKML verifier", cmd: "anchor init regulatory_oracle", done: false },
        { id: "t4", label: "anchor init audit_merkle — SPL Account Compression wrapper", cmd: "anchor init audit_merkle", done: false },
        { id: "t5", label: "Configure Cursor rules: Rust, Anchor, no-unsafe, clippy pedantic", cmd: "echo '# Cursor rules applied'", done: false },
        { id: "t6", label: "Claude Code: scaffold all three programs' instruction structs", cmd: "claude 'scaffold Anchor instruction enum for hybrid_vault with: initialize_vault, deposit, withdraw, rebalance, freeze_account'", done: false },
      ],
    },
    {
      week: "W2",
      title: "hybrid_vault.rs — Token-2022 vault",
      tasks: [
        { id: "t7", label: "Implement Token-2022 mint with transfer hooks + metadata extension", cmd: "cargo add spl-token-2022 --features=all", done: false },
        { id: "t8", label: "Write initialize_vault: creates mint, vault PDA, multisig authority", cmd: "claude 'implement initialize_vault instruction in Anchor for Token-2022 vault with 4-of-7 multisig'", done: false },
        { id: "t9", label: "Write deposit/withdraw CPIs with transfer hook enforcement", cmd: "claude 'implement deposit instruction with spl-token-2022 transfer hook CPI and suitability check'", done: false },
        { id: "t10", label: "Write rebalance: validates PLONK proof before executing swaps", cmd: "claude 'implement rebalance with plonk_proof: [u8;192] param, verify before state mutation'", done: false },
        { id: "t11", label: "Write freeze_account: ZKML score gate (< 0.85 → freeze)", cmd: "claude 'implement freeze_account gated by zkml_score field, emit FreezeEvent'", done: false },
        { id: "t12", label: "anchor test — all vault instructions on localnet", cmd: "anchor test --skip-deploy", done: false },
      ],
    },
    {
      week: "W3",
      title: "regulatory_oracle.rs + Pyth",
      tasks: [
        { id: "t13", label: "Add pyth-sdk-solana dependency; pull SOL/USD + JUP/USD feeds", cmd: "cargo add pyth-sdk-solana", done: false },
        { id: "t14", label: "Implement consume_pyth_price: confidence band check (±2.5% gate)", cmd: "claude 'consume_pyth_price instruction: read PriceFeed, assert confidence/price < 0.025, else emit OracleGatedEvent'", done: false },
        { id: "t15", label: "Implement update_risk_params: 5% drawdown, 0.85 score, 3–5× leverage", cmd: "claude 'RiskParams struct: max_drawdown_bps=500, freeze_score_bps=8500, leverage_min=300, leverage_max=500'", done: false },
        { id: "t16", label: "Integrate ZKML verifier stub: verify_anomaly_proof instruction", cmd: "claude 'stub verify_anomaly_proof(proof: [u8;192], public_inputs: Vec<u64>) -> Result<()>'", done: false },
        { id: "t17", label: "CPI from hybrid_vault into regulatory_oracle before any rebalance", cmd: "claude 'add CPI call from rebalance instruction to verify_anomaly_proof before token transfers'", done: false },
        { id: "t18", label: "Devnet deploy + Pyth devnet price feed smoke test", cmd: "anchor deploy --provider.cluster devnet && anchor test --provider.cluster devnet", done: false },
      ],
    },
    {
      week: "W4",
      title: "audit_merkle.rs + Dilithium-3",
      tasks: [
        { id: "t19", label: "Add spl-account-compression; init ConcurrentMerkleTree depth:20", cmd: "cargo add spl-account-compression account-compression-cpi", done: false },
        { id: "t20", label: "Implement append_audit_entry: hash instruction data → leaf, append to tree", cmd: "claude 'append_audit_entry: compute leaf = sha256(slot || program_id || instruction_data || signer), call spl_account_compression::append'", done: false },
        { id: "t21", label: "Implement verify_audit_path: validate Merkle proof for any historical entry", cmd: "claude 'verify_audit_path instruction: takes leaf, proof, root — calls spl_account_compression::verify_leaf'", done: false },
        { id: "t22", label: "Dilithium-3 syscall shim: wrap sol_secp256k1_verify pattern for ML-DSA", cmd: "claude 'implement dilithium3_verify(sig: &[u8;2420], msg: &[u8], pk: &[u8;1312]) using solana syscall infrastructure'", done: false },
        { id: "t23", label: "Wire audit_merkle CPI into all hybrid_vault state-mutating instructions", cmd: "claude 'add append_audit_entry CPI at end of every vault instruction that mutates state'", done: false },
        { id: "t24", label: "Full integration test: deposit → rebalance → verify audit path on devnet", cmd: "anchor test --provider.cluster devnet -- --test-name integration_audit_trail", done: false },
      ],
    },
  ],
  p2: [
    {
      week: "W5",
      title: "EZKL circuit — anomaly detector",
      tasks: [
        { id: "t25", label: "Install EZKL CLI; define anomaly_detector.onnx model architecture", cmd: "pip install ezkl && ezkl --version", done: false },
        { id: "t26", label: "Train anomaly model on synthetic RIA portfolio drift data (10K samples)", cmd: "claude 'generate Python training script: IsolationForest on portfolio_drift, leverage_ratio, oracle_deviation → export ONNX'", done: false },
        { id: "t27", label: "ezkl gen-settings: configure KZG SRS, target 0.94 AUC constraint", cmd: "ezkl gen-settings -M anomaly_detector.onnx --target-accuracy=0.94", done: false },
        { id: "t28", label: "ezkl compile-circuit → anomaly_detector.ezkl (Bonsol-compatible)", cmd: "ezkl compile-circuit -M anomaly_detector.onnx -S settings.json --target=bonsol", done: false },
        { id: "t29", label: "Generate verification key (vk.bin) + proving key (pk.bin)", cmd: "ezkl setup -M anomaly_detector.onnx --vk-path=vk.bin --pk-path=pk.bin", done: false },
        { id: "t30", label: "Claude Code: write Rust PLONK verifier that consumes vk.bin on-chain", cmd: "claude 'write Anchor instruction that deserializes vk.bin from account data and calls plonky2_verify(proof, public_inputs, vk)'", done: false },
      ],
    },
    {
      week: "W6",
      title: "Bonsol integration + on-chain verify",
      tasks: [
        { id: "t31", label: "Install Bonsol CLI; register anomaly_detector circuit on devnet", cmd: "cargo install bonsol-cli && bonsol deploy --circuit=anomaly_detector.ezkl --cluster=devnet", done: false },
        { id: "t32", label: "Write Bonsol execution request CPI from regulatory_oracle", cmd: "claude 'implement request_zkml_execution: CPI into Bonsol program with circuit_id, input_commitment, callback_program_id'", done: false },
        { id: "t33", label: "Implement zkml_callback instruction: receives proof, verifies, stores score", cmd: "claude 'implement zkml_callback instruction: verify Bonsol proof, update risk_score in RiskState account, emit ZKMLScoreEvent'", done: false },
        { id: "t34", label: "Wire freeze gate: if zkml_score < freeze_threshold → auto-freeze vault", cmd: "claude 'in zkml_callback: if verified_score < risk_params.freeze_score_bps/10000 { cpi into hybrid_vault::freeze_account }'", done: false },
        { id: "t35", label: "Test full ZKML loop: generate proof → submit → verify → freeze on devnet", cmd: "anchor test -- --test-name zkml_freeze_integration", done: false },
        { id: "t36", label: "Benchmark proof generation time; target < 8 seconds for 95th percentile", cmd: "ezkl prove --benchmark --percentile=95 -M anomaly_detector.onnx", done: false },
      ],
    },
    {
      week: "W7",
      title: "Jupiter + Kamino CPIs",
      tasks: [
        { id: "t37", label: "Integrate Jupiter Aggregator v6 CPI for vault swap execution", cmd: "cargo add jupiter-amm-interface", done: false },
        { id: "t38", label: "Implement execute_swap: validates oracle gate → calls Jupiter → appends audit", cmd: "claude 'implement execute_swap: check Pyth confidence, call jupiter_swap CPI, verify slippage < 50bps, append audit leaf'", done: false },
        { id: "t39", label: "Integrate Kamino Lend CPI for yield vault deposits", cmd: "cargo add kamino-lending-interface", done: false },
        { id: "t40", label: "Implement deposit_yield: routes idle USDC to Kamino pool, tracks receipt token", cmd: "claude 'implement deposit_yield: CPI into kamino_lending deposit instruction, store cToken balance in VaultState'", done: false },
        { id: "t41", label: "Implement harvest_yield: withdraw from Kamino, append yield event to audit trail", cmd: "claude 'implement harvest_yield: CPI kamino redeem, record yield_amount in audit leaf, emit HarvestEvent'", done: false },
        { id: "t42", label: "Integration test: deposit USDC → route to Kamino → harvest yield on devnet", cmd: "anchor test --provider.cluster devnet -- --test-name yield_integration", done: false },
      ],
    },
    {
      week: "W8",
      title: "RWA wrappers + SPL compression audit",
      tasks: [
        { id: "t43", label: "Design RWA token schema: Token-2022 + metadata extension for T-bill wrapper", cmd: "claude 'define Token-2022 metadata extension schema for US T-bill RWA: CUSIP, maturity_date, par_value, reg_exemption fields'", done: false },
        { id: "t44", label: "Implement mint_rwa: authority-gated, appends compliance proof to audit trail", cmd: "claude 'implement mint_rwa: require dilithium3_verified authority, mint Token-2022 with metadata, append_audit_entry with compliance_proof field'", done: false },
        { id: "t45", label: "Implement burn_rwa: validates redemption proof before burning tokens", cmd: "claude 'implement burn_rwa: verify redemption_proof via regulatory_oracle CPI, burn tokens, emit RedemptionEvent to audit_merkle'", done: false },
        { id: "t46", label: "SPL compression: stress test 10,000 audit entries; verify root hash consistency", cmd: "anchor test -- --test-name audit_stress_10k", done: false },
        { id: "t47", label: "Generate Merkle proof for entry #5,000; verify on-chain via verify_audit_path", cmd: "anchor test -- --test-name merkle_proof_verify", done: false },
        { id: "t48", label: "Full devnet smoke test: all 12 instructions in sequence with audit trail verification", cmd: "anchor test --provider.cluster devnet -- --test-name full_smoke_test", done: false },
      ],
    },
  ],
  p3: [
    {
      week: "W9",
      title: "Next.js 15 dashboard scaffold",
      tasks: [
        { id: "t49", label: "Init Next.js 15 App Router project in apps/web", cmd: "pnpm create next-app@latest apps/web --typescript --tailwind --app --src-dir", done: false },
        { id: "t50", label: "Install Solana wallet adapter, @solana/web3.js v2, Anchor client libs", cmd: "pnpm add @solana/wallet-adapter-react @solana/web3.js @coral-xyz/anchor", done: false },
        { id: "t51", label: "Claude Code: generate IDL TypeScript clients for all 3 Anchor programs", cmd: "claude 'generate TypeScript client hooks for hybrid_vault, regulatory_oracle, audit_merkle IDLs using @coral-xyz/anchor'", done: false },
        { id: "t52", label: "Build WalletProvider, ProgramProvider context — offline-first with service worker", cmd: "claude 'implement Next.js 15 WalletProvider with service worker registration for offline Solana state caching'", done: false },
        { id: "t53", label: "Scaffold 8 App Router sections: layout, routes, loading states", cmd: "claude 'generate Next.js 15 App Router file structure: dashboard, yield-rwa, risk-fortress, client-hub, simulator, optimizer, trade-desk, advisor-dao'", done: false },
        { id: "t54", label: "Configure Vercel project: env vars, Solana RPC endpoint, edge runtime", cmd: "vercel env add NEXT_PUBLIC_SOLANA_RPC NEXT_PUBLIC_CLUSTER ANCHOR_WALLET", done: false },
      ],
    },
    {
      week: "W10",
      title: "Risk Fortress + Audit UI",
      tasks: [
        { id: "t55", label: "Build RiskFortress component: live ZKML score gauge, Pyth feed, drawdown chart", cmd: "claude 'build RiskFortress React component: poll regulatory_oracle every 2s, render AUC gauge, Recharts drawdown timeline'", done: false },
        { id: "t56", label: "Build AuditTrail component: paginated Merkle entries with proof verification button", cmd: "claude 'build AuditTrail component: fetch SPL-compressed tree entries via RPC, render table with verify_audit_path button per row'", done: false },
        { id: "t57", label: "Build AnomalyFeed: real-time ZKML events via Solana websocket subscription", cmd: "claude 'implement AnomalyFeed: subscribe to ZKMLScoreEvent logs via connection.onLogs, parse and display with severity badge'", done: false },
        { id: "t58", label: "Build RiskParams editor: UI to update drawdown/leverage/freeze thresholds", cmd: "claude 'build RiskParams form: inputs for max_drawdown_bps, freeze_score_bps, leverage_min/max; call update_risk_params instruction on save'", done: false },
        { id: "t59", label: "Implement freeze dashboard: show frozen accounts, provide unfreeze with Dilithium-3 sig", cmd: "claude 'build FrozenAccounts panel: list accounts with freeze_timestamp, unfreeze button requiring WebAuthn + Dilithium3 signature'", done: false },
        { id: "t60", label: "Risk Fortress e2e: trigger freeze via ZKML score drop, verify UI reflects frozen state", cmd: "playwright test risk-fortress --headed", done: false },
      ],
    },
    {
      week: "W11",
      title: "Yield/RWA + Trade Desk UI",
      tasks: [
        { id: "t61", label: "Build YieldDashboard: APY charts for Aave/Jupiter/Kamino, RWA treasury allocation", cmd: "claude 'build YieldDashboard: Recharts AreaChart for 30d yield, pie chart for portfolio allocation, live Kamino APY via SDK'", done: false },
        { id: "t62", label: "Build PortfolioOptimizer: PLONK proof generation UI + efficient frontier chart", cmd: "claude 'build PortfolioOptimizer: input target weights, call WASM PLONK prover, display proof bytes + verify result, ScatterChart for frontier'", done: false },
        { id: "t63", label: "Build TradeDeskPanel: Jupiter swap UI with ZK execution proof display", cmd: "claude 'build TradeDeskPanel: Jupiter quote → execute_swap CPI, show slippage estimate, display ZK proof hash after confirmation'", done: false },
        { id: "t64", label: "Build RWAManager: mint/burn RWA tokens with compliance proof upload", cmd: "claude 'build RWAManager: file upload for compliance_proof, call mint_rwa with proof bytes, display Token-2022 metadata fields'", done: false },
        { id: "t65", label: "Build ClientHub: SPL-compressed CRM table with W3C VC credential status", cmd: "claude 'build ClientHub: table of clients with AUM, risk profile, zkCred status; on-chain lookup of compressed CRM state'", done: false },
        { id: "t66", label: "Build QuantumShadowWidget: year-selector, Dilithium-3 vs RSA resistance curves", cmd: "claude 'build QuantumShadowWidget: select year 2025–2033, Recharts LineChart of RSA/ECC/Dilithium3 resistance percentages'", done: false },
      ],
    },
    {
      week: "W12",
      title: "Testnet launch + design partner onboarding",
      tasks: [
        { id: "t67", label: "Deploy all 3 Anchor programs to Solana testnet; record program IDs", cmd: "anchor deploy --provider.cluster testnet && anchor idl init --filepath target/idl/hybrid_vault.json <PROGRAM_ID>", done: false },
        { id: "t68", label: "Deploy Next.js dashboard to Vercel production with testnet config", cmd: "vercel --prod --env NEXT_PUBLIC_CLUSTER=testnet", done: false },
        { id: "t69", label: "Onboard Design Partner 1: create vault, fund with test SOL, run first rebalance", cmd: "anchor run onboard-partner --provider.cluster testnet -- --partner=meridian_capital", done: false },
        { id: "t70", label: "Generate first real audit proof: verify via verify_audit_path, export Merkle proof", cmd: "anchor run export-audit-proof --provider.cluster testnet -- --entry-index=0", done: false },
        { id: "t71", label: "Run Alpenglow finality benchmark: measure slot-to-confirm for 100 transactions", cmd: "anchor run finality-bench --provider.cluster testnet -- --count=100", done: false },
        { id: "t72", label: "Security review: run cargo audit, clippy --deny warnings, semgrep Solana ruleset", cmd: "cargo audit && cargo clippy -- -D warnings && semgrep --config=p/solana-security .", done: false },
      ],
    },
  ],
};

const DEPS = [
  { from: "hybrid_vault.rs", to: "audit_merkle.rs", label: "CPI: append_audit_entry" },
  { from: "hybrid_vault.rs", to: "regulatory_oracle.rs", label: "CPI: verify_anomaly_proof" },
  { from: "regulatory_oracle.rs", to: "Bonsol SDK", label: "CPI: request_zkml_execution" },
  { from: "regulatory_oracle.rs", to: "Pyth SDK", label: "read: price feeds" },
  { from: "Bonsol SDK", to: "EZKL Circuit", label: "executes" },
  { from: "hybrid_vault.rs", to: "Jupiter CPI", label: "CPI: execute_swap" },
  { from: "hybrid_vault.rs", to: "Kamino CPI", label: "CPI: deposit/harvest" },
  { from: "Next.js 15", to: "hybrid_vault.rs", label: "Anchor client" },
  { from: "Next.js 15", to: "regulatory_oracle.rs", label: "Anchor client" },
  { from: "Next.js 15", to: "audit_merkle.rs", label: "Anchor client" },
  { from: "audit_merkle.rs", to: "SPL Compression", label: "uses" },
];

const CURSOR_RULES = `# .cursorrules — Zynt Protocol
# Applied to all Rust/Anchor/TypeScript in this monorepo

## Rust / Anchor
- Always use #[error_code] for custom errors, never panic!()
- Every instruction must call append_audit_entry CPI as last operation
- Use checked arithmetic: checked_add, checked_mul — never raw arithmetic
- Account validation: require!(condition, ErrorCode::X) before any mutation
- Zero-copy accounts: use #[account(zero_copy)] for large state
- No unsafe {} blocks anywhere in program code
- Dilithium-3 verify before any privileged instruction
- Emit events for every state change: emit!(EventName { ... })

## TypeScript / Next.js 15
- All Anchor calls must handle TransactionError with user-facing message
- Wallet adapter: never store private keys, always use signTransaction
- RPC calls: use connection.getLatestBlockhash('finalized') for Alpenglow
- Retry logic: exponential backoff for RPC rate limits (max 5 retries)
- Service worker: cache program IDLs and last-known account state offline

## Security
- No hardcoded program IDs: read from env or constants file
- No PII in on-chain account state
- Multisig required for: upgrade_authority, freeze_all, update_risk_params
- All PDAs must include discriminator in seed
`;

const CLAUDE_CODE_PROMPTS = [
  {
    category: "Anchor Program Scaffolding",
    color: "#00C2CC",
    prompts: [
      { label: "Scaffold vault instruction", cmd: `claude 'In hybrid_vault/src/lib.rs, implement the rebalance instruction:\n- Accepts proof: [u8; 192] (PLONK proof bytes)\n- CPIs into regulatory_oracle::verify_anomaly_proof\n- If verified, executes Jupiter swap via CPI\n- Appends audit leaf via audit_merkle CPI\n- Emits RebalanceEvent { slot, proof_hash, new_weights }\n- Uses checked arithmetic throughout\n- Returns Err(VaultError::InvalidProof) on proof failure'` },
      { label: "Generate Token-2022 setup", cmd: `claude 'In hybrid_vault, write initialize_vault instruction:\n- Creates Token-2022 mint with extensions: transfer_hook, metadata, confidential_transfer\n- Transfer hook: checks regulatory_oracle before any transfer\n- Vault PDA seeds: [b"vault", authority.key().as_ref()]\n- Multisig authority: 4-of-7 required for admin instructions\n- Stores VaultState: { mint, authority, risk_params_account, audit_tree_account }'` },
      { label: "PIIA error codes", cmd: `claude 'Generate complete #[error_code] enum for hybrid_vault covering: InvalidProof, DrawdownExceeded, LeverageCapExceeded, OracleConfidenceExceeded, AccountFrozen, InsufficientMultisig, InvalidDilithiumSignature, AuditAppendFailed'` },
    ],
  },
  {
    category: "ZKML Circuit Generation",
    color: "#A78BFA",
    prompts: [
      { label: "ONNX anomaly model", cmd: `claude 'Write Python script to:\n1. Generate 10,000 synthetic RIA portfolio samples with features:\n   portfolio_drift (0-0.3), leverage_ratio (1-5), oracle_deviation (0-0.1),\n   drawdown_pct (0-0.2), vol_30d (0-0.5)\n2. Label anomalies using IsolationForest contamination=0.05\n3. Train a 3-layer MLP classifier (sklearn → skl2onnx)\n4. Export to anomaly_detector.onnx\n5. Evaluate: target AUC > 0.94 on held-out test set\n6. Print classification report'` },
      { label: "Bonsol callback handler", cmd: `claude 'Write Anchor instruction zkml_callback in regulatory_oracle:\n- Accounts: [oracle_state, risk_params, bonsol_proof_account, hybrid_vault (CPI)]\n- Deserialize Bonsol proof verification result from proof_account\n- Update oracle_state.last_score = verified_score\n- If verified_score < risk_params.freeze_score_bps / 10000:\n  - CPI into hybrid_vault::freeze_account\n  - Emit FreezeTriggeredEvent { score, threshold, slot }\n- Append audit entry regardless of freeze outcome'` },
      { label: "EZKL settings for Solana", cmd: `claude 'Write ezkl_setup.py that:\n1. Loads anomaly_detector.onnx\n2. Calls ezkl.gen_settings with: target_accuracy=0.94, scale=7, bits=16\n3. Calibrates on 100 sample inputs\n4. Generates SRS via ezkl.get_srs (KZG, size=2^20)\n5. Compiles to Bonsol-compatible format\n6. Runs ezkl.setup() to produce vk.bin and pk.bin\n7. Verifies a sample proof end-to-end\n8. Prints proof size in bytes (target < 5KB)'` },
    ],
  },
  {
    category: "Next.js 15 Components",
    color: "#34D399",
    prompts: [
      { label: "Risk Fortress component", cmd: `claude 'Build RiskFortress.tsx in Next.js 15 App Router:\n- Real-time ZKML score via Solana websocket onLogs\n- Recharts RadialBarChart for risk score (0-1)\n- Recharts LineChart for 24h drawdown history\n- Pyth price feed display with confidence band\n- Anomaly events table: type, severity, AUC score, timestamp\n- Freeze account modal: requires WebAuthn authentication\n- Risk params editor: form with on-chain update\n- Tailwind dark theme, monospace font for numbers'` },
      { label: "Audit trail component", cmd: `claude 'Build AuditTrailPanel.tsx:\n- Fetch SPL-compressed tree leaves via getCompressedAccountsByOwner RPC\n- Display: slot, tx_hash, instruction_type, proof_status, merkle_root\n- Verify button: calls verify_audit_path on-chain, shows proof valid/invalid\n- Export button: downloads Merkle proof as JSON (SEC 17a-4 format)\n- Infinite scroll pagination\n- Real-time new entries via confirmations websocket\n- Highlight anomalous entries (freeze events, oracle gates) in amber'` },
      { label: "Wallet + offline service worker", cmd: `claude 'Implement service worker for Zynt Next.js 15 app:\n- Cache strategy: StaleWhileRevalidate for program IDLs\n- IndexedDB: store last-known VaultState, RiskParams, AuditTree root\n- Background sync: queue failed transactions for retry when online\n- Offline banner: show when connection.getVersion() fails\n- Register in app/layout.tsx with useEffect\n- WorkboxPlugin integration in next.config.js'` },
    ],
  },
];

const METRICS = [
  { label: "Anchor Programs", value: "3", sub: "hybrid_vault · oracle · audit_merkle", color: "#00C2CC" },
  { label: "Instructions", value: "18", sub: "across 3 programs", color: "#00C2CC" },
  { label: "ZKML Target AUC", value: "0.94", sub: "IsolationForest + MLP", color: "#A78BFA" },
  { label: "Proof Size Target", value: "<5 KB", sub: "PLONK, Bonsol-compatible", color: "#A78BFA" },
  { label: "Finality (Alpenglow)", value: "≤400ms", sub: "testnet measured target", color: "#34D399" },
  { label: "Audit Entries", value: "1M+", sub: "~0.01 SOL via SPL compression", color: "#34D399" },
];

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&family=Inter:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #060B14; --surf: #0B1320; --card: #0F1A2E; --border: #162035;
    --border2: #1E3050; --teal: #00C2CC; --purple: #A78BFA; --green: #34D399;
    --amber: #FBB040; --red: #F87171; --text: #E2EAF4; --muted: #5A7090;
    --muted2: #3D5272;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: 'IBM Plex Mono', monospace; font-size: 13px; }

  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
  @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
  @keyframes glow { 0%,100% { box-shadow: 0 0 8px currentColor; } 50% { box-shadow: 0 0 20px currentColor, 0 0 40px currentColor; } }
  @keyframes typeIn { from { width: 0; } to { width: 100%; } }
  @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
  @keyframes slideIn { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:none; } }

  .scanline {
    position: fixed; inset: 0; pointer-events: none; z-index: 9999;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
  }
  .app { display: flex; flex-direction: column; min-height: 100vh; }
  .topbar {
    height: 48px; background: #070D1C; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; padding: 0 20px; gap: 20px; position: sticky; top: 0; z-index: 100;
  }
  .logo { font-family: 'Syne', sans-serif; font-size: 17px; font-weight: 800; color: var(--text); letter-spacing: .04em; }
  .logo span { color: var(--teal); }
  .topbar-sep { width: 1px; height: 20px; background: var(--border); }
  .topbar-meta { font-size: 10px; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 6px var(--green); animation: pulse 2s ease-in-out infinite; display: inline-block; }
  .tab-bar { display: flex; border-bottom: 1px solid var(--border); background: var(--surf); padding: 0 20px; gap: 2px; overflow-x: auto; }
  .tab { padding: 10px 16px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all .15s; white-space: nowrap; font-family: 'IBM Plex Mono', monospace; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--teal); border-bottom-color: var(--teal); }
  .main { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px; max-width: 1400px; margin: 0 auto; width: 100%; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 3px; overflow: hidden; position: relative; animation: fadeUp .3s ease forwards; }
  .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--teal), transparent); opacity: .3; }
  .card-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .card-title { font-size: 10px; font-weight: 600; color: var(--teal); text-transform: uppercase; letter-spacing: .1em; }
  .card-sub { font-size: 9px; color: var(--muted); margin-top: 2px; }
  .badge { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 2px; font-size: 9px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .grid6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }

  /* Metrics */
  .metric { padding: 14px 16px; }
  .metric-val { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; line-height: 1; }
  .metric-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  .metric-sub { font-size: 9px; color: var(--muted2); margin-top: 2px; }
  .metric-bar { height: 2px; border-radius: 1px; margin-top: 8px; }

  /* Phase cards */
  .phase-card { padding: 16px; cursor: pointer; transition: all .2s; border-bottom: 3px solid transparent; }
  .phase-card:hover { background: #101828; }
  .phase-card.active { background: #101828; }
  .phase-num { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 6px; }
  .phase-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; margin-bottom: 3px; }
  .phase-days { font-size: 9px; color: var(--muted); }

  /* Sprint */
  .sprint-week { border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
  .sprint-week-header { padding: 8px 12px; display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
  .sprint-week-title { font-size: 11px; font-weight: 600; flex: 1; }
  .sprint-week-body { padding: 0 8px 8px; }
  .task-row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: 2px; cursor: pointer; transition: background .1s; margin-bottom: 2px; }
  .task-row:hover { background: #0a1422; }
  .task-check { width: 14px; height: 14px; border-radius: 2px; border: 1px solid var(--border2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; transition: all .15s; }
  .task-check.done { background: var(--green); border-color: var(--green); }
  .task-label { font-size: 11px; color: var(--text); flex: 1; line-height: 1.5; }
  .task-label.done { color: var(--muted2); text-decoration: line-through; }
  .task-cmd-btn { font-size: 9px; color: var(--muted); border: 1px solid var(--border); padding: 1px 6px; border-radius: 2px; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: all .15s; font-family: 'IBM Plex Mono', monospace; }
  .task-cmd-btn:hover { color: var(--teal); border-color: var(--teal); background: rgba(0,194,204,.05); }

  /* Command modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal { background: var(--surf); border: 1px solid var(--border2); border-radius: 4px; max-width: 680px; width: 100%; max-height: 80vh; overflow-y: auto; }
  .modal-header { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .modal-close { color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 2px; transition: color .15s; }
  .modal-close:hover { color: var(--text); }
  .cmd-block { margin: 16px 18px; background: #050A12; border: 1px solid var(--border); border-radius: 3px; padding: 14px 16px; font-size: 11px; line-height: 1.7; color: #7DEFA1; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .copy-btn { margin: 0 18px 16px; padding: 6px 14px; background: transparent; border: 1px solid var(--border2); color: var(--teal); font-size: 10px; font-family: 'IBM Plex Mono', monospace; border-radius: 2px; cursor: pointer; letter-spacing: .06em; transition: all .15s; text-transform: uppercase; }
  .copy-btn:hover { background: rgba(0,194,204,.08); }

  /* Claude prompts */
  .prompt-cat { margin-bottom: 16px; }
  .prompt-cat-title { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 8px; padding: 0 16px; }
  .prompt-item { padding: 10px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: background .1s; cursor: pointer; }
  .prompt-item:hover { background: #0a1422; }
  .prompt-label { font-size: 11px; color: var(--text); }
  .prompt-run { font-size: 9px; color: var(--purple); border: 1px solid var(--purple); padding: 2px 8px; border-radius: 2px; white-space: nowrap; transition: all .15s; }
  .prompt-run:hover { background: rgba(167,139,250,.1); }

  /* Dep graph */
  .dep-node { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 2px; font-size: 10px; font-weight: 600; border: 1px solid; cursor: default; }
  .dep-arrow { color: var(--muted2); font-size: 10px; }
  .dep-label { font-size: 9px; color: var(--muted); margin: 0 6px; }

  /* Cursor rules */
  .rules-block { background: #050A12; border: 1px solid var(--border); border-radius: 3px; padding: 14px 16px; font-size: 10px; line-height: 1.8; color: #7DEFA1; overflow-x: auto; white-space: pre-wrap; margin: 0 16px 16px; }
  .rules-line-comment { color: var(--muted2); }
  .rules-line-key { color: var(--teal); }

  /* Progress */
  .progress-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
  .prog-text { position: absolute; font-family: 'Syne', sans-serif; font-weight: 800; font-size: 11px; }

  /* Toolchain */
  .tool-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; background: var(--surf); border: 1px solid var(--border2); border-radius: 2px; font-size: 10px; color: var(--muted); margin: 3px; }
  .tool-chip-dot { width: 5px; height: 5px; border-radius: 50%; }

  /* Timeline bar */
  .timeline { display: flex; align-items: stretch; height: 6px; border-radius: 3px; overflow: hidden; gap: 2px; margin: 12px 0; }
  .timeline-seg { flex: 1; border-radius: 1px; }

  /* Week progress */
  .week-progress { width: 60px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .week-progress-fill { height: 100%; border-radius: 2px; transition: width .3s ease; }

  /* Alpenglow badge */
  .alpenglow { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; background: rgba(0,194,204,.06); border: 1px solid rgba(0,194,204,.2); border-radius: 2px; font-size: 9px; color: rgba(0,194,204,.7); letter-spacing: .06em; }
`;

export default function ZyntRoadmap() {
  const [activeTab, setActiveTab] = useState("roadmap");
  const [activePhase, setActivePhase] = useState("p1");
  const [tasks, setTasks] = useState(() => {
    const all = {};
    Object.entries(SPRINTS).forEach(([phase, weeks]) => {
      weeks.forEach(week => {
        week.tasks.forEach(t => { all[t.id] = false; });
      });
    });
    return all;
  });
  const [openWeeks, setOpenWeeks] = useState({ W1: true, W5: true, W9: true });
  const [modal, setModal] = useState(null);
  const [copied, setCopied] = useState(false);

  const toggleTask = (id) => setTasks(p => ({ ...p, [id]: !p[id] }));
  const toggleWeek = (w) => setOpenWeeks(p => ({ ...p, [w]: !p[w] }));

  const phaseProgress = (phaseId) => {
    const weeks = SPRINTS[phaseId];
    let total = 0, done = 0;
    weeks.forEach(w => w.tasks.forEach(t => { total++; if (tasks[t.id]) done++; }));
    return total ? Math.round((done / total) * 100) : 0;
  };

  const totalProgress = () => {
    let total = 0, done = 0;
    Object.values(SPRINTS).forEach(weeks => weeks.forEach(w => w.tasks.forEach(t => { total++; if (tasks[t.id]) done++; })));
    return total ? Math.round((done / total) * 100) : 0;
  };

  const copyCmd = async (cmd) => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const phase = PHASES.find(p => p.id === activePhase);
  const pProgress = phaseProgress(activePhase);

  const tabs = [
    { id: "roadmap", label: "Sprint Roadmap" },
    { id: "deps", label: "Dependency Graph" },
    { id: "prompts", label: "Claude Code Prompts" },
    { id: "cursor", label: "Cursor Rules" },
    { id: "toolchain", label: "Toolchain" },
  ];

  // Render cursor rules with syntax coloring
  const renderRules = () => {
    return CURSOR_RULES.split('\n').map((line, i) => {
      if (line.startsWith('#')) return <div key={i} style={{ color: '#3D5272' }}>{line}</div>;
      if (line.startsWith('-')) return <div key={i}><span style={{ color: '#00C2CC' }}>  –</span><span style={{ color: '#A78BFA' }}>{line.slice(1)}</span></div>;
      if (line.startsWith('##')) return <div key={i} style={{ color: '#FBB040', marginTop: 4 }}>{line}</div>;
      return <div key={i} style={{ color: '#5A7090' }}>{line}</div>;
    });
  };

  return (
    <>
      <style>{css}</style>
      <div className="scanline" />
      <div className="app">
        {/* Topbar */}
        <div className="topbar">
          <div className="logo">ZYNT <span>MVP</span></div>
          <div className="topbar-sep" />
          <div className="topbar-meta">90-Day Engineering Roadmap</div>
          <div className="topbar-sep" />
          <div className="alpenglow">⚡ Alpenglow ≤400ms</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="dot" />
            <span style={{ fontSize: 10, color: '#3D5272' }}>
              {totalProgress()}% complete · {Object.values(tasks).filter(Boolean).length}/{Object.keys(tasks).length} tasks
            </span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          {tabs.map(t => (
            <div key={t.id} className={`tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </div>
          ))}
        </div>

        <div className="main">

          {/* ─── METRICS ROW ─── */}
          <div className="grid6">
            {METRICS.map((m, i) => (
              <div key={i} className="card metric" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="metric-val" style={{ color: m.color }}>{m.value}</div>
                <div className="metric-label">{m.label}</div>
                <div className="metric-sub">{m.sub}</div>
                <div className="metric-bar" style={{ background: m.color, opacity: 0.3, width: `${40 + i * 10}%` }} />
              </div>
            ))}
          </div>

          {/* ─── GLOBAL TIMELINE ─── */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.08em' }}>90-Day Progress Timeline</span>
              <span style={{ fontSize: 11, color: '#00C2CC', fontWeight: 600 }}>{totalProgress()}% complete</span>
            </div>
            <div className="timeline">
              {PHASES.map(p => (
                <div key={p.id} className="timeline-seg" style={{ background: p.dimColor, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${phaseProgress(p.id)}%`, background: p.color, transition: 'width .4s ease', opacity: .85 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 0 }}>
              {PHASES.map(p => (
                <div key={p.id} style={{ flex: 1, fontSize: 9, color: p.color, letterSpacing: '.06em' }}>
                  {p.label} · {p.days} · {phaseProgress(p.id)}%
                </div>
              ))}
            </div>
          </div>

          {/* ─── SPRINT ROADMAP TAB ─── */}
          {activeTab === 'roadmap' && (
            <div>
              {/* Phase selector */}
              <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, marginBottom: 12 }}>
                {PHASES.map((p, i) => (
                  <div
                    key={p.id}
                    className={`phase-card${activePhase === p.id ? ' active' : ''}`}
                    onClick={() => setActivePhase(p.id)}
                    style={{
                      borderBottom: `3px solid ${activePhase === p.id ? p.color : 'transparent'}`,
                      borderRight: i < 2 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div className="phase-num" style={{ color: p.color }}>{p.label} — {p.days}</div>
                    <div className="phase-title" style={{ color: p.color }}>{p.title}</div>
                    <div className="phase-days" style={{ marginBottom: 10 }}>{p.goal}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 3, background: p.dimColor, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${phaseProgress(p.id)}%`, background: p.color, transition: 'width .4s ease' }} />
                      </div>
                      <span style={{ fontSize: 9, color: p.color, fontWeight: 600 }}>{phaseProgress(p.id)}%</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Active phase toolchain */}
              <div className="card" style={{ padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontSize: 9, color: '#5A7090', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                  {phase.label} Toolchain
                </div>
                <div>
                  {phase.toolchain.map((t, i) => (
                    <span key={i} className="tool-chip">
                      <span className="tool-chip-dot" style={{ background: phase.color }} />
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sprint weeks */}
              <div className="grid2">
                {SPRINTS[activePhase].map((week, wi) => {
                  const weekDone = week.tasks.filter(t => tasks[t.id]).length;
                  const weekTotal = week.tasks.length;
                  const isOpen = openWeeks[week.week];
                  return (
                    <div key={week.week} className="card sprint-week" style={{ animationDelay: `${wi * 0.08}s` }}>
                      <div
                        className="sprint-week-header"
                        style={{ background: '#0B1320', borderBottom: isOpen ? '1px solid var(--border)' : 'none' }}
                        onClick={() => toggleWeek(week.week)}
                      >
                        <span className="badge" style={{ background: phase.dimColor, color: phase.color, marginRight: 4 }}>{week.week}</span>
                        <span className="sprint-week-title">{week.title}</span>
                        <div className="week-progress">
                          <div className="week-progress-fill" style={{ width: `${weekTotal ? (weekDone / weekTotal) * 100 : 0}%`, background: phase.color }} />
                        </div>
                        <span style={{ fontSize: 9, color: phase.color, marginLeft: 6, width: 32, textAlign: 'right' }}>{weekDone}/{weekTotal}</span>
                        <span style={{ marginLeft: 8, color: '#3D5272', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>
                      </div>
                      {isOpen && (
                        <div className="sprint-week-body">
                          {week.tasks.map(task => (
                            <div key={task.id} className="task-row" onClick={() => toggleTask(task.id)}>
                              <div className={`task-check${tasks[task.id] ? ' done' : ''}`} style={{ borderColor: tasks[task.id] ? phase.color : undefined }}>
                                {tasks[task.id] && <span style={{ fontSize: 8, color: '#060B14', fontWeight: 800 }}>✓</span>}
                              </div>
                              <span className={`task-label${tasks[task.id] ? ' done' : ''}`}>{task.label}</span>
                              <span
                                className="task-cmd-btn"
                                onClick={e => { e.stopPropagation(); setModal({ label: task.label, cmd: task.cmd }); }}
                              >
                                cmd
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── DEPENDENCY GRAPH TAB ─── */}
          {activeTab === 'deps' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Program Dependency Graph</div>
                  <div className="card-sub">Anchor CPI relationships · SDK integrations · data flows</div>
                </div>
              </div>
              <div style={{ padding: 20 }}>
                {/* Central programs */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                  {[
                    { label: 'hybrid_vault.rs', color: '#00C2CC' },
                    { label: 'regulatory_oracle.rs', color: '#A78BFA' },
                    { label: 'audit_merkle.rs', color: '#34D399' },
                  ].map(n => (
                    <div key={n.label} className="dep-node" style={{ borderColor: n.color, color: n.color, background: `${n.color}12`, fontSize: 11 }}>
                      {n.label}
                    </div>
                  ))}
                </div>

                {/* Dependency rows */}
                {DEPS.map((dep, i) => {
                  const fromColor = dep.from.includes('vault') ? '#00C2CC' : dep.from.includes('oracle') ? '#A78BFA' : dep.from.includes('merkle') ? '#34D399' : dep.from === 'Next.js 15' ? '#FBB040' : dep.from === 'Bonsol SDK' ? '#A78BFA' : '#5A7090';
                  const toColor = dep.to.includes('vault') ? '#00C2CC' : dep.to.includes('oracle') ? '#A78BFA' : dep.to.includes('merkle') ? '#34D399' : dep.to === 'EZKL Circuit' ? '#A78BFA' : dep.to === 'SPL Compression' ? '#34D399' : '#5A7090';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', animation: `slideIn .3s ease ${i * 0.04}s both` }}>
                      <div className="dep-node" style={{ borderColor: fromColor, color: fromColor, background: `${fromColor}10`, minWidth: 180 }}>{dep.from}</div>
                      <div className="dep-arrow" style={{ margin: '0 10px' }}>→</div>
                      <div className="dep-label" style={{ flex: 1, textAlign: 'center' }}>{dep.label}</div>
                      <div className="dep-arrow" style={{ margin: '0 10px' }}>→</div>
                      <div className="dep-node" style={{ borderColor: toColor, color: toColor, background: `${toColor}10`, minWidth: 180, justifyContent: 'flex-end' }}>{dep.to}</div>
                    </div>
                  );
                })}

                {/* Alpenglow note */}
                <div style={{ marginTop: 20, padding: 14, background: 'rgba(0,194,204,.04)', border: '1px solid rgba(0,194,204,.15)', borderRadius: 3 }}>
                  <div style={{ fontSize: 10, color: '#00C2CC', fontWeight: 600, marginBottom: 6, letterSpacing: '.06em' }}>// ALPENGLOW FINALITY NOTES</div>
                  {[
                    "All CPI calls in hybrid_vault use connection.getLatestBlockhash('finalized') — Alpenglow confirms in ≤400ms",
                    "audit_merkle append uses getRecentBlockhash with commitment: 'confirmed' — sub-slot accuracy for audit timestamps",
                    "regulatory_oracle Pyth feed consumption is slot-gated: only consume feeds from current_slot - 1 to avoid stale data",
                    "zkml_callback confirmation: subscribe via onAccountChange with commitment: 'finalized' for Alpenglow guarantee",
                  ].map((n, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#3D5272', marginBottom: 4, paddingLeft: 8 }}>– {n}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── CLAUDE CODE PROMPTS TAB ─── */}
          {activeTab === 'prompts' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Claude Code Prompt Library</div>
                  <div className="card-sub">Copy · paste into claude terminal · iterate</div>
                </div>
                <span className="badge" style={{ background: 'rgba(167,139,250,.1)', color: '#A78BFA', border: '1px solid rgba(167,139,250,.2)' }}>
                  {CLAUDE_CODE_PROMPTS.reduce((a, c) => a + c.prompts.length, 0)} prompts
                </span>
              </div>
              {CLAUDE_CODE_PROMPTS.map((cat, ci) => (
                <div key={ci} className="prompt-cat" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="prompt-cat-title" style={{ color: cat.color, paddingTop: 12 }}>
                    {cat.category}
                  </div>
                  {cat.prompts.map((p, pi) => (
                    <div key={pi} className="prompt-item" onClick={() => setModal({ label: p.label, cmd: p.cmd })}>
                      <span className="prompt-label">{p.label}</span>
                      <span className="prompt-run" style={{ borderColor: cat.color, color: cat.color }}>View prompt →</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: '#3D5272', lineHeight: 1.8 }}>
                  <span style={{ color: '#5A7090' }}>// Usage:</span> Run <span style={{ color: '#34D399' }}>claude</span> in your Zynt monorepo root.
                  All prompts assume Cursor IDE is open with the monorepo context loaded.
                  Use <span style={{ color: '#00C2CC' }}>claude --continue</span> to maintain session context across related prompts.
                  Anchor-specific prompts assume <span style={{ color: '#A78BFA' }}>anchor 0.31.x</span> and <span style={{ color: '#A78BFA' }}>solana-program 1.18</span>.
                </div>
              </div>
            </div>
          )}

          {/* ─── CURSOR RULES TAB ─── */}
          {activeTab === 'cursor' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">.cursorrules — Zynt Protocol</div>
                  <div className="card-sub">Place in monorepo root · applies to all Rust, TypeScript, and Anchor files</div>
                </div>
                <button className="copy-btn" onClick={() => copyCmd(CURSOR_RULES)} style={{ margin: 0, padding: '4px 12px' }}>
                  {copied ? '✓ Copied' : 'Copy rules'}
                </button>
              </div>
              <div className="rules-block">{renderRules()}</div>
              <div style={{ padding: '0 16px 16px' }}>
                <div style={{ fontSize: 10, color: '#3D5272', lineHeight: 1.8 }}>
                  <div style={{ color: '#5A7090', marginBottom: 6 }}>// Additional Cursor settings (settings.json):</div>
                  {[
                    `"cursor.ai.model": "claude-sonnet-4-6"  // Recommended for Anchor/Rust`,
                    `"cursor.ai.contextSize": "max"          // Load full monorepo context`,
                    `"rust-analyzer.cargo.features": ["all"] // Enable all feature flags`,
                    `"rust-analyzer.checkOnSave.command": "clippy"  // Lint on save`,
                    `"editor.formatOnSave": true             // Rustfmt on every save`,
                  ].map((line, i) => (
                    <div key={i} style={{ color: '#A78BFA', marginBottom: 2 }}>{line}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── TOOLCHAIN TAB ─── */}
          {activeTab === 'toolchain' && (
            <div>
              <div className="grid3">
                {[
                  {
                    title: "Phase 1 — Anchor Stack", color: "#00C2CC",
                    tools: [
                      { name: "Rust", version: "1.78+", note: "stable, not nightly" },
                      { name: "Anchor CLI", version: "0.31.x", note: "anchor build, test, deploy" },
                      { name: "Solana CLI", version: "1.18.x", note: "solana-test-validator, airdrop" },
                      { name: "spl-token-2022", version: "latest", note: "Token-2022 extensions" },
                      { name: "spl-account-compression", version: "0.3.x", note: "ConcurrentMerkleTree" },
                      { name: "pyth-sdk-solana", version: "0.10.x", note: "price feed consumer" },
                      { name: "Cursor IDE", version: "latest", note: "AI-native editor" },
                      { name: "Claude Code", version: "latest", note: "terminal AI agent" },
                    ]
                  },
                  {
                    title: "Phase 2 — ZK Stack", color: "#A78BFA",
                    tools: [
                      { name: "EZKL CLI", version: "0.9.x", note: "circuit compile + prove" },
                      { name: "Bonsol SDK", version: "0.2.x", note: "on-chain ZK execution" },
                      { name: "plonky2", version: "0.1.x", note: "PLONK backend for Anchor" },
                      { name: "onnx-runtime", version: "1.17.x", note: "model inference for training" },
                      { name: "scikit-learn", version: "1.4.x", note: "IsolationForest + MLP" },
                      { name: "skl2onnx", version: "1.16.x", note: "sklearn → ONNX export" },
                      { name: "dilithium3-rust", version: "custom", note: "ML-DSA syscall shim" },
                      { name: "jupiter-amm-interface", version: "latest", note: "swap CPI" },
                    ]
                  },
                  {
                    title: "Phase 3 — Product Stack", color: "#34D399",
                    tools: [
                      { name: "Next.js", version: "15 App Router", note: "frontend framework" },
                      { name: "@solana/web3.js", version: "v2", note: "RPC + transactions" },
                      { name: "@coral-xyz/anchor", version: "0.31.x", note: "IDL client generation" },
                      { name: "@solana/wallet-adapter", version: "latest", note: "Phantom, Backpack" },
                      { name: "Recharts", version: "2.x", note: "dashboard charts" },
                      { name: "Tailwind CSS", version: "4.x", note: "styling" },
                      { name: "Vercel", version: "latest", note: "edge deployment" },
                      { name: "Playwright", version: "1.44.x", note: "e2e test suite" },
                    ]
                  },
                ].map((col, ci) => (
                  <div key={ci} className="card">
                    <div className="card-header">
                      <div className="card-title" style={{ color: col.color }}>{col.title}</div>
                    </div>
                    <div style={{ padding: '8px 0' }}>
                      {col.tools.map((t, ti) => (
                        <div key={ti} style={{ padding: '7px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 11, color: col.color, fontWeight: 600, minWidth: 160 }}>{t.name}</span>
                          <span style={{ fontSize: 10, color: '#5A7090' }}>v{t.version}</span>
                          <span style={{ fontSize: 9, color: '#3D5272', marginLeft: 'auto' }}>{t.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Setup commands */}
              <div className="card" style={{ marginTop: 12 }}>
                <div className="card-header">
                  <div className="card-title">One-Shot Setup Commands</div>
                  <div className="card-sub">Run in order from clean macOS/Linux environment</div>
                </div>
                <div style={{ padding: '12px 16px' }}>
                  {[
                    { label: "1. Install Rust + Solana + Anchor", color: "#00C2CC", cmd: `# Rust\ncurl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n\n# Solana CLI\nsh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"\n\n# Anchor via AVM\ncargo install --git https://github.com/coral-xyz/anchor avm --locked\navm install 0.31.0 && avm use 0.31.0` },
                    { label: "2. Init Zynt monorepo", color: "#A78BFA", cmd: `pnpm create turbo@latest zynt-protocol --package-manager=pnpm\ncd zynt-protocol\nmkdir -p programs/hybrid_vault programs/regulatory_oracle programs/audit_merkle apps/web\nanchor init hybrid_vault --path programs/hybrid_vault\nanchor init regulatory_oracle --path programs/regulatory_oracle\nanchor init audit_merkle --path programs/audit_merkle` },
                    { label: "3. Install EZKL + Python ZK deps", color: "#A78BFA", cmd: `pip install ezkl onnxruntime scikit-learn skl2onnx numpy pandas\nezkl --version  # should be 0.9.x\n\n# Generate SRS (run once, ~5 min)\nezkl get-srs --logrows=20 --commitment=kzg` },
                    { label: "4. Init Next.js dashboard", color: "#34D399", cmd: `pnpm create next-app@latest apps/web \\\n  --typescript --tailwind --app --src-dir --no-git\n\ncd apps/web\npnpm add @solana/web3.js @coral-xyz/anchor \\\n  @solana/wallet-adapter-react @solana/wallet-adapter-wallets \\\n  recharts @lightprotocol/stateless.js` },
                    { label: "5. Configure Solana for devnet", color: "#34D399", cmd: `solana config set --url https://api.devnet.solana.com\nsolana-keygen new --outfile ~/.config/solana/zynt-devnet.json\nsolana config set --keypair ~/.config/solana/zynt-devnet.json\nsolana airdrop 10  # fund devnet wallet\nsolana balance     # confirm 10 SOL` },
                  ].map((step, i) => (
                    <div key={i} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 10, color: step.color, fontWeight: 600 }}>{step.label}</span>
                        <button className="task-cmd-btn" onClick={() => setModal({ label: step.label, cmd: step.cmd })}>view</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            {['Anchor 0.31', 'Token-2022', 'SPL-Compression', 'EZKL 0.9', 'Bonsol', 'Pyth SDK', 'Jupiter v6', 'Kamino', 'Dilithium-3', 'Next.js 15', 'Vercel Edge'].map(t => (
              <span key={t} style={{ fontSize: 9, color: '#3D5272', borderRight: '1px solid var(--border)', paddingRight: 16 }}>{t}</span>
            ))}
          </div>
        </div>

        {/* ─── COMMAND MODAL ─── */}
        {modal && (
          <div className="modal-overlay" onClick={() => setModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#00C2CC' }}>{modal.label}</div>
                  <div style={{ fontSize: 9, color: '#5A7090', marginTop: 2 }}>Copy and run in your Zynt monorepo</div>
                </div>
                <span className="modal-close" onClick={() => setModal(null)}>✕</span>
              </div>
              <div className="cmd-block">{modal.cmd}</div>
              <button className="copy-btn" onClick={() => copyCmd(modal.cmd)}>
                {copied ? '✓ Copied to clipboard' : '⧉ Copy command'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
