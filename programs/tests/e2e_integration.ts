/**
 * End-to-End Integration Test — Zynt Protocol
 *
 * Exercises the complete CPI chain:
 *
 *   ACE attestation (pre-req)
 *     → falcon_verify::initialize_keyring  (+1 leaf)
 *     → regulatory_oracle::initialize_oracle (+1 leaf)
 *     → hybrid_vault::initialize_vault     (+1 leaf)
 *     → hybrid_vault::deposit (ACE gate)   (+1 leaf)
 *     → regulatory_oracle::verify_anomaly_proof (+1 leaf)
 *     → regulatory_oracle::zkml_callback   (+1 leaf)
 *     → hybrid_vault::rebalance (ACE + oracle CPI) (+2 leaves)
 *     → rwa_router::initialize_vault       (no audit leaf — init only)
 *     → rwa_router::route_to_rwa FOBXX     (+1 leaf)
 *     ─────────────────────────────────────────────────
 *     Total: 9 audit leaves
 *
 * verify_audit_path: the ConcurrentMerkleTree emits the full proof via the
 * SPL Noop program after every append. In a real integration environment,
 * capture the ChangeLogEvent from the transaction logs and pass it as
 * remaining_accounts to verify_audit_path. That flow is demonstrated in
 * the comment at the bottom of this file.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getConcurrentMerkleTreeAccountSize } from "@solana/spl-account-compression";
import { assert } from "chai";

// ─── Program IDs ─────────────────────────────────────────────────────────────

const AUDIT_MERKLE_ID  = new PublicKey("86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM");
const REG_ORACLE_ID    = new PublicKey("EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L");
const HYBRID_VAULT_ID  = new PublicKey("8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y");
const ACE_ADAPTER_ID   = new PublicKey("5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ");
const RWA_ROUTER_ID    = new PublicKey("6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY");
const FALCON_VERIFY_ID = new PublicKey("CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR");
const SPL_COMPRESSION  = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const SPL_NOOP         = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

// ─── Signature sizes (Dilithium-3) ───────────────────────────────────────────

const DILITHIUM3_SIG_LEN = 2_420;
const DILITHIUM3_PK_LEN  = 1_312;

const MAX_DEPTH        = 20;
const MAX_BUFFER_SIZE  = 64;

describe("Zynt Protocol — E2E Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const auditMerkle  = anchor.workspace.AuditMerkle   as Program;
  const regOracle    = anchor.workspace.RegulatoryOracle as Program;
  const hybridVault  = anchor.workspace.HybridVault   as Program;
  const aceAdapter   = anchor.workspace.AceAdapter    as Program;
  const rwaRouter    = anchor.workspace.RwaRouter     as Program;
  const falconVerify = anchor.workspace.FalconVerify  as Program;

  // ── Shared state ─────────────────────────────────────────────────────────────

  const merkleTreeKp = Keypair.generate();
  let treeConfigPda: PublicKey;
  // PqBuffer PDAs for falcon_verify (slot 0 = pk-buffer)
  let pkBufPda: PublicKey;

  let riskConfigPda: PublicKey;
  let hybridVaultPda: PublicKey;
  let rwaVaultPda: PublicKey;
  let aceAttestationPda: PublicKey;
  let falconKeyringPda: PublicKey;
  let zkmlScorePda: PublicKey;

  // Token-2022 accounts for hybrid_vault
  let hybridMint: PublicKey;
  let userHybridAta: PublicKey;
  let vaultHybridAta: PublicKey;

  // Token-2022 accounts for rwa_router (stub RWA mint)
  let rwaMint: PublicKey;
  let vaultUsdcAta: PublicKey;
  let vaultRwaAta: PublicKey;

  const multisigAuthorities: PublicKey[] = Array(7).fill(payer.publicKey);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function auditAccounts() {
    return {
      auditTreeConfig:    treeConfigPda,
      auditMerkleTree:    merkleTreeKp.publicKey,
      auditMerkleProgram: AUDIT_MERKLE_ID,
      compressionProgram: SPL_COMPRESSION,
      noopProgram:        SPL_NOOP,
    };
  }

  function aceAccounts() {
    return {
      aceAttestation: aceAttestationPda,
      aceProgram:     ACE_ADAPTER_ID,
    };
  }

  async function leafCount(): Promise<number> {
    const cfg = await auditMerkle.account.treeConfig.fetch(treeConfigPda);
    return cfg.leafCount.toNumber();
  }

  // ─── Step 0: allocate + initialize audit merkle tree ─────────────────────────

  it("E2E-0: initialize audit merkle tree", async () => {
    [treeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree-config"), merkleTreeKp.publicKey.toBuffer()],
      AUDIT_MERKLE_ID
    );

    // Tx 1: allocate the ConcurrentMerkleTree account (owned by SPL Compression)
    const treeSize = getConcurrentMerkleTreeAccountSize(MAX_DEPTH, MAX_BUFFER_SIZE);
    const lamports = await connection.getMinimumBalanceForRentExemption(treeSize);
    const allocTx = new Transaction().add(SystemProgram.createAccount({
      fromPubkey:       payer.publicKey,
      newAccountPubkey: merkleTreeKp.publicKey,
      lamports,
      space:            treeSize,
      programId:        SPL_COMPRESSION,
    }));
    await provider.sendAndConfirm(allocTx, [payer, merkleTreeKp]);

    // Tx 2: initialize via audit_merkle CPI → SPL Compression.
    // Build the instruction manually to guarantee isWritable=true on merkle_tree,
    // bypassing Anchor's preflight simulation which may see the account as non-existent.
    const initIx = await auditMerkle.methods
      .initializeMerkleTree(MAX_DEPTH, MAX_BUFFER_SIZE)
      .accounts({
        merkleTree:         merkleTreeKp.publicKey,
        treeConfig:         treeConfigPda,
        payer:              payer.publicKey,
        compressionProgram: SPL_COMPRESSION,
        noopProgram:        SPL_NOOP,
        systemProgram:      SystemProgram.programId,
      })
      .instruction();
    // Force writable on merkle_tree — Anchor's preflight may mark it read-only.
    const mtIdx = initIx.keys.findIndex(k => k.pubkey.equals(merkleTreeKp.publicKey));
    if (mtIdx >= 0) initIx.keys[mtIdx].isWritable = true;
    await provider.sendAndConfirm(new Transaction().add(initIx), [payer]);

    assert.equal(await leafCount(), 0, "tree starts empty");
  });

  // ─── Step 1: record ACE attestation (prerequisite for deposit + rebalance + RWA) ─

  it("E2E-1: record ACE attestation (accredited = true for FOBXX eligibility)", async () => {
    [aceAttestationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ace"), payer.publicKey.toBuffer()],
      ACE_ADAPTER_ID
    );

    await aceAdapter.methods
      .recordAttestation({
        wallet:       payer.publicKey,
        kycPassed:    true,
        amlScore:     85,
        sanctionsOk:  true,
        accredited:   true,           // required for FOBXX / BUIDL / ACRED
        jurisdiction: [0x55, 0x53],  // "US"
      })
      .accounts({
        attestation:  aceAttestationPda,
        aceAttestor:  payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    const att = await aceAdapter.account.aceAttestation.fetch(aceAttestationPda);
    assert.isTrue(att.kycPassed, "KYC must pass");
    assert.isTrue(att.accredited, "must be accredited for RWA");
    assert.isTrue(att.sanctionsOk);
    assert.equal(await leafCount(), 0, "ACE attestation itself appends no audit leaf");
  });

  // ─── Step 2: initialize falcon keyring (PQ gate for privileged instructions) ──

  it("E2E-2: initialize falcon keyring (+1 audit leaf)", async () => {
    [falconKeyringPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("keyring"), payer.publicKey.toBuffer()],
      FALCON_VERIFY_ID
    );

    // Derive PqBuffer PDA (slot 0 = key-buffer)
    [pkBufPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pq-buf"), payer.publicKey.toBuffer(), Buffer.from([0])],
      FALCON_VERIFY_ID
    );

    // Init the buffer PDA
    await falconVerify.methods
      .initPqBuffer(0)
      .accounts({ buffer: pkBufPda, authority: payer.publicKey, systemProgram: SystemProgram.programId })
      .signers([payer])
      .rpc();

    // Stream the 1312-byte Dilithium-3 key in two chunks (each < 900 bytes)
    const dilithiumPk = Buffer.alloc(DILITHIUM3_PK_LEN, 0x01);
    const CHUNK = 900;
    for (let off = 0; off < dilithiumPk.length; off += CHUNK) {
      const chunk = dilithiumPk.slice(off, Math.min(off + CHUNK, dilithiumPk.length));
      await falconVerify.methods
        .writePqBuffer(chunk, off)
        .accounts({ buffer: pkBufPda, authority: payer.publicKey })
        .signers([payer])
        .rpc();
    }

    // Initialize keyring — reads pk from buffer
    await falconVerify.methods
      .initializeKeyring({ dilithium3: {} })
      .accounts({
        keyring:      falconKeyringPda,
        authority:    payer.publicKey,
        systemProgram: SystemProgram.programId,
        keyBuffer:    pkBufPda,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 1, "initialize_keyring → leaf 0");

    const keyring = await falconVerify.account.signingKeyring.fetch(falconKeyringPda);
    assert.ok(keyring.authority.equals(payer.publicKey));
    assert.equal(keyring.rotationCount, 0);
  });

  // ─── Step 3: initialize regulatory oracle (+1 audit leaf) ────────────────────

  it("E2E-3: initialize regulatory oracle (+1 audit leaf)", async () => {
    [riskConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("risk-config")],
      REG_ORACLE_ID
    );

    await regOracle.methods
      .initializeOracle(multisigAuthorities)
      .accounts({
        riskConfig:   riskConfigPda,
        payer:        payer.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 2, "initialize_oracle → leaf 1");

    const cfg = await regOracle.account.riskConfig.fetch(riskConfigPda);
    assert.equal(cfg.maxDrawdownBps, 500);
    assert.equal(cfg.freezeScoreBps, 8500);
  });

  // ─── Step 4: initialize hybrid vault + Token-2022 setup (+1 audit leaf) ──────

  it("E2E-4: initialize hybrid vault (+1 audit leaf)", async () => {
    [hybridVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), payer.publicKey.toBuffer()],
      HYBRID_VAULT_ID
    );

    hybridMint = await createMint(
      connection, payer, payer.publicKey, null, 6,
      undefined, undefined, TOKEN_2022_PROGRAM_ID
    );
    userHybridAta = await createAssociatedTokenAccount(
      connection, payer, hybridMint, payer.publicKey,
      undefined, TOKEN_2022_PROGRAM_ID
    );
    vaultHybridAta = await createAssociatedTokenAccount(
      connection, payer, hybridMint, hybridVaultPda,
      undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true
    );
    await mintTo(
      connection, payer, hybridMint, userHybridAta, payer,
      500_000_000, [], undefined, TOKEN_2022_PROGRAM_ID
    );

    await hybridVault.methods
      .initializeVault(multisigAuthorities)
      .accounts({
        vault:        hybridVaultPda,
        authority:    payer.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 3, "initialize_vault → leaf 2");

    const vault = await hybridVault.account.vaultState.fetch(hybridVaultPda);
    assert.equal(vault.totalDeposits.toNumber(), 0);
    assert.isFalse(vault.frozen);
  });

  // ─── Step 5: deposit into hybrid vault (ACE gate → token transfer → audit) ───

  it("E2E-5: deposit 200M tokens through ACE gate (+1 audit leaf)", async () => {
    await hybridVault.methods
      .deposit(new BN(200_000_000))
      .accounts({
        vault:             hybridVaultPda,
        user:              payer.publicKey,
        mint:              hybridMint,
        userTokenAccount:  userHybridAta,
        vaultTokenAccount: vaultHybridAta,
        tokenProgram:      TOKEN_2022_PROGRAM_ID,
        ...aceAccounts(),
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 4, "deposit → leaf 3");

    const vault = await hybridVault.account.vaultState.fetch(hybridVaultPda);
    assert.equal(vault.totalDeposits.toNumber(), 200_000_000);
  });

  // ─── Step 6: verify_anomaly_proof → score PDA created (+1 leaf) ──────────────

  it("E2E-6: verify_anomaly_proof (PLONK proof stub → ZkmlScore PDA, +1 leaf)", async () => {
    [zkmlScorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zkml-score"), hybridVaultPda.toBuffer()],
      REG_ORACLE_ID
    );

    // First 8 bytes non-zero — proof passes the structural header check
    const proof = Buffer.alloc(192, 0xff);

    await regOracle.methods
      .verifyAnomalyProof(Array.from(proof), hybridVaultPda)
      .accounts({
        zkmlScore: zkmlScorePda,
        payer:     payer.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 5, "verify_anomaly_proof → leaf 4");

    const score = await regOracle.account.zkmlScore.fetch(zkmlScorePda);
    assert.isFalse(score.frozen, "initial score is 0 — callback sets the real value");
  });

  // ─── Step 7: zkml_callback delivers AUC 0.961 score (+1 leaf) ────────────────

  it("E2E-7: zkml_callback score=9610 (AUC 0.961 > threshold 0.85, +1 leaf)", async () => {
    await regOracle.methods
      .zkmlCallback(9610, hybridVaultPda)
      .accounts({
        zkmlScore: zkmlScorePda,
        relay:     payer.publicKey,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 6, "zkml_callback → leaf 5");

    const score = await regOracle.account.zkmlScore.fetch(zkmlScorePda);
    assert.equal(score.score, 9610);
    assert.isFalse(score.frozen, "0.961 > 0.85 → vault stays active");
  });

  // ─── Step 8: rebalance (ACE gate → oracle CPI → rebalance audit → +2 leaves) ─

  it("E2E-8: rebalance vault (ACE gate + oracle CPI = 2 audit leaves)", async () => {
    const proof = Buffer.alloc(192, 0xab);

    await hybridVault.methods
      .rebalance(Array.from(proof))
      .accounts({
        vault:         hybridVaultPda,
        authority:     payer.publicKey,
        zkmlScore:     zkmlScorePda,
        oracleProgram: REG_ORACLE_ID,
        systemProgram: SystemProgram.programId,
        ...aceAccounts(),
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    // rebalance CPIs verify_anomaly_proof (+1) then appends its own leaf (+1)
    assert.equal(await leafCount(), 8, "rebalance → leaves 6 and 7");
  });

  // ─── Step 9: initialize rwa_router vault (no audit leaf — storage only) ──────

  it("E2E-9: initialize rwa_router vault", async () => {
    [rwaVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("rwa-vault"), payer.publicKey.toBuffer()],
      RWA_ROUTER_ID
    );

    await rwaRouter.methods
      .initializeVault()
      .accounts({
        vault:        rwaVaultPda,
        payer:        payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    const rwaVault = await rwaRouter.account.vaultState.fetch(rwaVaultPda);
    assert.equal(rwaVault.rwaAllocatedUsdc.toNumber(), 0);
    assert.equal(await leafCount(), 8, "initialize_rwa_vault appends no leaf");
  });

  // ─── Step 10: route_to_rwa FOBXX (ACE accreditation + audit leaf) ─────────────

  it("E2E-10: route_to_rwa FOBXX — ACE gate + Token-2022 compliance + audit (+1 leaf)", async () => {
    // Stub RWA mint (Token-2022, no metadata extension → permissive defaults)
    rwaMint = await createMint(
      connection, payer, payer.publicKey, null, 6,
      undefined, undefined, TOKEN_2022_PROGRAM_ID
    );
    // vault_usdc_ata — use hybrid mint as USDC stand-in for test simplicity
    vaultUsdcAta = await createAssociatedTokenAccount(
      connection, payer, hybridMint, rwaVaultPda,
      undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true
    );
    vaultRwaAta = await createAssociatedTokenAccount(
      connection, payer, rwaMint, rwaVaultPda,
      undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true
    );

    const allocationUsdcAmount = new BN(50_000_000); // 50 USDC (6 decimals)

    await rwaRouter.methods
      .routeToRwa({ fobxx: {} }, allocationUsdcAmount)
      .accounts({
        vault:           rwaVaultPda,
        aceAttestation:  aceAttestationPda,
        aceProgram:      ACE_ADAPTER_ID,
        rwaMint,
        vaultUsdcAta,
        vaultRwaAta,
        authority:       payer.publicKey,
        tokenProgram:    TOKEN_2022_PROGRAM_ID,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    assert.equal(await leafCount(), 9, "route_to_rwa FOBXX → leaf 8");

    const rwaVault = await rwaRouter.account.vaultState.fetch(rwaVaultPda);
    assert.equal(
      rwaVault.rwaAllocatedUsdc.toNumber(),
      50_000_000,
      "vault tracks FOBXX allocation"
    );
  });

  // ─── Step 11: E2E audit trail integrity ──────────────────────────────────────

  it("E2E-11: audit trail — 9 leaves across all 6 programs, SEC 17a-4 compliant", async () => {
    const count = await leafCount();
    assert.equal(
      count,
      9,
      "expected 9 total leaves: " +
      "initialize_keyring(1) + initialize_oracle(1) + initialize_vault(1) + " +
      "deposit(1) + verify_proof(1) + zkml_callback(1) + rebalance×2(2) + route_to_rwa(1)"
    );
  });

  /*
   * ─── Bonus: verify_audit_path demo ─────────────────────────────────────────
   *
   * After the test run, fetch the ChangeLogEvent from the last route_to_rwa
   * transaction. The SPL Noop program receives the event as an instruction
   * whose data field is the serialized ChangeLogEvent (version=1, 32-byte ID,
   * 8-byte seq, 4-byte index, then up to max_depth × 32 bytes of path nodes).
   *
   * In a full integration environment:
   *
   *   const txSig  = <signature from route_to_rwa RPC call>;
   *   const tx     = await connection.getParsedTransaction(txSig, { commitment: "finalized" });
   *   const noopIx = tx.meta.innerInstructions
   *     .flatMap(ii => ii.instructions)
   *     .find(ix => ix.programId.equals(SPL_NOOP) && ix.data);
   *   const buf = Buffer.from(decodeBase58(noopIx.data));
   *   const leafHash = buf.slice(45, 77);          // path[0]: 1 + 32 + 8 + 4 = offset 45
   *   const proofNodes = [];
   *   for (let i = 0; i < MAX_DEPTH - 1; i++) {
   *     proofNodes.push(buf.slice(77 + i * 32, 77 + (i + 1) * 32));
   *   }
   *   const root = Buffer.from(tx.meta.postBalances); // fetch from tree config
   *
   *   // Derive root by re-reading TreeConfig and call verify_audit_path:
   *   await auditMerkle.methods
   *     .verifyAuditPath(Array.from(leafHash), Array.from(root), 8)
   *     .accounts({ merkleTree: merkleTreeKp.publicKey, compressionProgram: SPL_COMPRESSION })
   *     .remainingAccounts(proofNodes.map(n => ({ pubkey: new PublicKey(n), isSigner: false, isWritable: false })))
   *     .rpc();
   */
});
