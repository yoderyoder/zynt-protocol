/**
 * Phase 0 integration tests — audit_merkle, regulatory_oracle, hybrid_vault
 *
 * Run with: anchor test --skip-deploy
 *
 * Test order:
 *   0. Record ACE attestation for vaultAuthority (pre-requisite for deposit/rebalance)
 *   1. Initialize the merkle audit tree
 *   2. Initialize the regulatory oracle
 *   3. Initialize the vault
 *   4. Deposit into vault  (→ ACE gate + audit leaf)
 *   5. verify_anomaly_proof + zkml_callback (→ 2 audit leaves)
 *   6. Rebalance vault    (→ ACE gate + 2 audit leaves: oracle receipt + rebalance)
 *   7. freeze_account     (→ audit leaf, privileged)
 *   8. Withdraw fails on frozen vault
 *   9. Audit-trail integrity: leaf_count matches expected
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
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getConcurrentMerkleTreeAccountSize,
} from "@solana/spl-account-compression";
import { assert } from "chai";

// Program IDs from Anchor.toml [programs.localnet]
const AUDIT_MERKLE_ID   = new PublicKey("86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM");
const REG_ORACLE_ID     = new PublicKey("EGkzA4YWfDdUsJUTqUmNp7WGfe1XrMK8miYKdeWnxn6L");
const HYBRID_VAULT_ID   = new PublicKey("8roQCkKU3HRYM8nAdqUTWjWYdQ984fgFiL5JfveNoh4Y");
const ACE_ADAPTER_ID    = new PublicKey("5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ");
const FALCON_VERIFY_ID  = new PublicKey("CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR");
const SPL_COMPRESSION   = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const SPL_NOOP          = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

const MAX_DEPTH        = 20;
const MAX_BUFFER_SIZE  = 64;
const DILITHIUM3_SIG_LEN = 2420;
const DILITHIUM3_PK_LEN  = 1312;

describe("Zynt Protocol — Phase 0", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // Dedicated vault authority — avoids PDA conflicts with e2e_integration which
  // uses payer.publicKey for vault/keyring/PqBuffer seeds.
  const vaultAuthority = Keypair.generate();

  // Load IDL-generated programs
  const auditMerkle   = anchor.workspace.AuditMerkle   as Program;
  const regOracle     = anchor.workspace.RegulatoryOracle as Program;
  const hybridVault   = anchor.workspace.HybridVault   as Program;
  const aceAdapter    = anchor.workspace.AceAdapter     as Program;
  const falconVerify  = anchor.workspace.FalconVerify  as Program;

  // ── Shared state ──────────────────────────────────────────────────────────
  const merkleTreeKp = Keypair.generate();
  let treeConfigPda: PublicKey;
  let treeConfigBump: number;

  let riskConfigPda: PublicKey;
  let vaultPda: PublicKey;
  let vaultBump: number;

  let mint: PublicKey;
  let userAta: PublicKey;
  let vaultAta: PublicKey;

  // ACE attestation PDA for vaultAuthority (used in deposit + rebalance)
  let aceAttestationPda: PublicKey;

  // PqBuffer PDAs for PQ signature/key staging (freeze test)
  let sigBufPda: PublicKey;
  let pkBufPda: PublicKey;

  // 7 multisig authorities (using vaultAuthority as all 7 for test simplicity)
  const multisigAuthorities: PublicKey[] = Array(7).fill(vaultAuthority.publicKey);

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  async function getTreeConfig() {
    return auditMerkle.account.treeConfig.fetch(treeConfigPda);
  }

  // Fund vaultAuthority before any tests run
  before(async () => {
    const airdropSig = await connection.requestAirdrop(vaultAuthority.publicKey, 10_000_000_000);
    await connection.confirmTransaction(airdropSig, "confirmed");
  });

  // ── 0. Record ACE attestation for vaultAuthority ──────────────────────────

  it("records ACE attestation for payer (pre-requisite)", async () => {
    [aceAttestationPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ace"), vaultAuthority.publicKey.toBuffer()],
      ACE_ADAPTER_ID
    );

    await aceAdapter.methods
      .recordAttestation({
        wallet:       vaultAuthority.publicKey,
        kycPassed:    true,
        amlScore:     80,
        sanctionsOk:  true,
        accredited:   true,
        jurisdiction: [0x55, 0x53], // "US"
      })
      .accounts({
        attestation:  aceAttestationPda,
        aceAttestor:  payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    const att = await aceAdapter.account.aceAttestation.fetch(aceAttestationPda);
    assert.ok(att.wallet.equals(vaultAuthority.publicKey), "attestation wallet = vaultAuthority");
    assert.isTrue(att.kycPassed, "KYC must pass");
    assert.isTrue(att.sanctionsOk, "sanctions must be clear");
    assert.equal(att.amlScore, 80, "AML score stored correctly");
  });

  // ── 1. Initialize merkle audit tree ───────────────────────────────────────

  it("initializes the audit merkle tree", async () => {
    // Derive tree_config PDA
    [treeConfigPda, treeConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree-config"), merkleTreeKp.publicKey.toBuffer()],
      AUDIT_MERKLE_ID
    );

    // Tx 1: allocate the ConcurrentMerkleTree account
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
    // Build instruction manually to guarantee isWritable=true on merkle_tree,
    // bypassing Anchor preflight which may see the account as non-existent.
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
    const mtIdx = initIx.keys.findIndex(k => k.pubkey.equals(merkleTreeKp.publicKey));
    if (mtIdx >= 0) initIx.keys[mtIdx].isWritable = true;
    await provider.sendAndConfirm(new Transaction().add(initIx), [payer]);

    const cfg = await getTreeConfig();
    assert.ok(cfg.merkleTree.equals(merkleTreeKp.publicKey));
    assert.equal(cfg.leafCount.toNumber(), 0);
    assert.equal(cfg.bump, treeConfigBump);
  });

  // ── 2. Initialize regulatory oracle ───────────────────────────────────────
  // Uses init_if_needed — safe to call even if oracle exists from another suite.

  it("initializes the regulatory oracle", async () => {
    [riskConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("risk-config")],
      REG_ORACLE_ID
    );

    await regOracle.methods
      .initializeOracle(multisigAuthorities)
      .accounts({
        riskConfig:  riskConfigPda,
        payer:       payer.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    const cfg = await regOracle.account.riskConfig.fetch(riskConfigPda);
    assert.equal(cfg.maxDrawdownBps, 500);
    assert.equal(cfg.freezeScoreBps, 8500);
    assert.equal(cfg.leverageMin, 300);
    assert.equal(cfg.leverageMax, 500);

    // leaf_count should now be 1
    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 1, "initialize_oracle must append audit leaf");
  });

  // ── 3. Initialize vault ───────────────────────────────────────────────────
  // Uses vaultAuthority as the vault creator to avoid PDA conflict with e2e.

  it("initializes the hybrid vault", async () => {
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), vaultAuthority.publicKey.toBuffer()],
      HYBRID_VAULT_ID
    );

    // Create a Token-2022 mint + ATAs
    mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    userAta = await createAssociatedTokenAccount(
      connection, payer, mint, vaultAuthority.publicKey, undefined, TOKEN_2022_PROGRAM_ID
    );
    vaultAta = await createAssociatedTokenAccount(
      connection, payer, mint, vaultPda, undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true
    );
    await mintTo(connection, payer, mint, userAta, payer, 1_000_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);

    await hybridVault.methods
      .initializeVault(multisigAuthorities)
      .accounts({
        vault:        vaultPda,
        authority:    vaultAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([vaultAuthority])
      .rpc();

    const vault = await hybridVault.account.vaultState.fetch(vaultPda);
    assert.ok(vault.authority.equals(vaultAuthority.publicKey));
    assert.equal(vault.totalDeposits.toNumber(), 0);
    assert.isFalse(vault.frozen);
    assert.equal(vault.bump, vaultBump);

    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 2, "initialize_vault must append audit leaf");
  });

  // ── 4. Deposit ────────────────────────────────────────────────────────────

  it("deposits tokens into the vault", async () => {
    const amount = new BN(100_000_000); // 100 tokens

    await hybridVault.methods
      .deposit(amount)
      .accounts({
        vault:            vaultPda,
        user:             vaultAuthority.publicKey,
        mint,
        userTokenAccount: userAta,
        vaultTokenAccount: vaultAta,
        tokenProgram:     TOKEN_2022_PROGRAM_ID,
        ...aceAccounts(),
        ...auditAccounts(),
      })
      .signers([vaultAuthority])
      .rpc();

    const vault = await hybridVault.account.vaultState.fetch(vaultPda);
    assert.equal(vault.totalDeposits.toNumber(), 100_000_000);

    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 3, "deposit must append audit leaf");
  });

  // ── 5. ZKML proof + callback ──────────────────────────────────────────────

  it("verifies anomaly proof and delivers zkml_callback", async () => {
    const vaultKey = vaultPda;
    const [zkmlScorePda, zkmlBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("zkml-score"), vaultKey.toBuffer()],
      REG_ORACLE_ID
    );

    // PLONK proof: 192 non-zero bytes (stub)
    const proof = Buffer.alloc(192, 0xff);

    await regOracle.methods
      .verifyAnomalyProof(Array.from(proof), vaultKey)
      .accounts({
        zkmlScore: zkmlScorePda,
        payer:     payer.publicKey,
        systemProgram: SystemProgram.programId,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    // Leaf count: +1 from verify_anomaly_proof
    const treeAfterProof = await getTreeConfig();
    assert.equal(treeAfterProof.leafCount.toNumber(), 4);

    // Deliver callback: score = 9610 (0.961, above 0.85 threshold → not frozen)
    await regOracle.methods
      .zkmlCallback(9610, vaultKey)
      .accounts({
        zkmlScore: zkmlScorePda,
        relay:     payer.publicKey,
        ...auditAccounts(),
      })
      .signers([payer])
      .rpc();

    const score = await regOracle.account.zkmlScore.fetch(zkmlScorePda);
    assert.equal(score.score, 9610);
    assert.isFalse(score.frozen, "score 0.961 must not trigger freeze");

    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 5, "zkml_callback must append audit leaf");
  });

  // ── 6. Rebalance ─────────────────────────────────────────────────────────

  it("rebalances the vault (PLONK gate + oracle audit + rebalance audit)", async () => {
    const proof = Buffer.alloc(192, 0xab);
    const [zkmlScorePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("zkml-score"), vaultPda.toBuffer()],
      REG_ORACLE_ID
    );

    await hybridVault.methods
      .rebalance(Array.from(proof))
      .accounts({
        vault:          vaultPda,
        authority:      vaultAuthority.publicKey,
        zkmlScore:      zkmlScorePda,
        oracleProgram:  REG_ORACLE_ID,
        systemProgram:  SystemProgram.programId,
        ...aceAccounts(),
        ...auditAccounts(),
      })
      .signers([vaultAuthority])
      .rpc();

    // rebalance CPIs to verify_anomaly_proof (+1 leaf) then appends its own (+1)
    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 7, "rebalance must produce 2 audit leaves");
  });

  // ── 7. freeze_account (privileged, PQ sig) ────────────────────────────────

  it("freezes the vault with a PQ signature + 4-of-7 multisig", async () => {
    // Derive PqBuffer PDAs using vaultAuthority (slot 0 = pk-buffer, slot 1 = sig-buffer)
    [pkBufPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pq-buf"), vaultAuthority.publicKey.toBuffer(), Buffer.from([0])],
      FALCON_VERIFY_ID
    );
    [sigBufPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pq-buf"), vaultAuthority.publicKey.toBuffer(), Buffer.from([1])],
      FALCON_VERIFY_ID
    );

    // Init pk-buffer
    await falconVerify.methods.initPqBuffer(0)
      .accounts({ buffer: pkBufPda, authority: vaultAuthority.publicKey, systemProgram: SystemProgram.programId })
      .signers([vaultAuthority]).rpc();

    // Init sig-buffer
    await falconVerify.methods.initPqBuffer(1)
      .accounts({ buffer: sigBufPda, authority: vaultAuthority.publicKey, systemProgram: SystemProgram.programId })
      .signers([vaultAuthority]).rpc();

    // Stream Dilithium-3 public key (1312 bytes) into pk-buffer
    const pqPubkey = Buffer.alloc(DILITHIUM3_PK_LEN, 0xdd);
    const CHUNK = 900;
    for (let off = 0; off < pqPubkey.length; off += CHUNK) {
      const chunk = pqPubkey.slice(off, Math.min(off + CHUNK, pqPubkey.length));
      await falconVerify.methods.writePqBuffer(chunk, off)
        .accounts({ buffer: pkBufPda, authority: vaultAuthority.publicKey })
        .signers([vaultAuthority]).rpc();
    }

    // Stream Dilithium-3 signature (2420 bytes) into sig-buffer in chunks
    const pqSig = Buffer.alloc(DILITHIUM3_SIG_LEN, 0xcc);
    for (let off = 0; off < pqSig.length; off += CHUNK) {
      const chunk = pqSig.slice(off, Math.min(off + CHUNK, pqSig.length));
      await falconVerify.methods.writePqBuffer(chunk, off)
        .accounts({ buffer: sigBufPda, authority: vaultAuthority.publicKey })
        .signers([vaultAuthority]).rpc();
    }

    // Pass vaultAuthority as all 4 required signers via remaining_accounts
    const remainingSigners = Array(4).fill({
      pubkey: vaultAuthority.publicKey,
      isSigner: true,
      isWritable: false,
    });

    await hybridVault.methods
      .freezeAccount(vaultPda)
      .accounts({
        vault:        vaultPda,
        authority:    vaultAuthority.publicKey,
        falconProgram: FALCON_VERIFY_ID,
        sigBuffer:    sigBufPda,
        pkBuffer:     pkBufPda,
        ...auditAccounts(),
      })
      .remainingAccounts(remainingSigners)
      .signers([vaultAuthority])
      .rpc();

    const vault = await hybridVault.account.vaultState.fetch(vaultPda);
    assert.isTrue(vault.frozen, "vault must be frozen after freeze_account");

    const tree = await getTreeConfig();
    assert.equal(tree.leafCount.toNumber(), 8, "freeze_account must append audit leaf");
  });

  // ── 8. Withdraw fails on frozen vault ────────────────────────────────────

  it("rejects withdraw on a frozen vault", async () => {
    let threw = false;
    try {
      await hybridVault.methods
        .withdraw(new BN(1_000))
        .accounts({
          vault:            vaultPda,
          user:             vaultAuthority.publicKey,
          mint,
          userTokenAccount: userAta,
          vaultTokenAccount: vaultAta,
          tokenProgram:     TOKEN_2022_PROGRAM_ID,
          systemProgram:    SystemProgram.programId,
          ...auditAccounts(),
        })
        .signers([vaultAuthority])
        .rpc();
    } catch (e: any) {
      threw = true;
      assert.include(e.toString(), "VaultFrozen");
    }
    assert.isTrue(threw, "withdraw on frozen vault must throw VaultFrozen");
  });

  // ── 9. Audit-trail integrity ──────────────────────────────────────────────

  it("audit trail leaf_count matches expected total (8 operations)", async () => {
    const tree = await getTreeConfig();
    assert.equal(
      tree.leafCount.toNumber(),
      8,
      "expected 8 total audit leaves: init_oracle(1) + init_vault(1) + deposit(1) " +
      "+ verify_proof(1) + zkml_callback(1) + rebalance×2(2) + freeze(1)"
    );
  });
});
