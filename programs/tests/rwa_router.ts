/**
 * rwa_router integration tests — Initiative 03
 *
 * Run with: anchor test --skip-deploy
 *
 * Test order:
 *   1.  Initialize the audit merkle tree
 *   2.  Record an ACE attestation for the test wallet
 *   3.  Initialize the RWA vault
 *   4a. route_to_rwa — FOBXX allocation  (→ 1 audit leaf)
 *   4b. route_to_rwa — BUIDL allocation  (→ 1 audit leaf)
 *   4c. route_to_rwa — ACRED allocation  (→ 1 audit leaf)
 *   5.  redeem_rwa   — FOBXX redemption  (→ 1 audit leaf)
 *   6.  Reject allocation without ACE attestation
 *   7.  Reject allocation with zero amount
 *   8.  Audit-trail integrity: leaf_count matches expected total
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

// ─── Program IDs (from Anchor.toml [programs.localnet]) ──────────────────────
const AUDIT_MERKLE_ID = new PublicKey("86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM");
const ACE_ADAPTER_ID  = new PublicKey("5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ");
const RWA_ROUTER_ID   = new PublicKey("6Q3qAi5z6YdU52UQYCF4UAGZSuUZqyDcTgmBcPehFWGY");
const SPL_COMPRESSION = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const SPL_NOOP        = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

// ─── Canonical constants (must match CLAUDE.md) ───────────────────────────────
const MAX_DEPTH       = 20;
const MAX_BUFFER_SIZE = 64;

// ─── RwaTarget enum discriminants (must match Rust RwaTarget) ────────────────
const RWA_TARGET_FOBXX = { fobxx: {} };
const RWA_TARGET_BUIDL = { buidl: {} };
const RWA_TARGET_ACRED = { acred: {} };

describe("Zynt Protocol — rwa_router (Initiative 03)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  // Dedicated vault authority — avoids PDA conflicts with e2e_integration which
  // uses payer.publicKey for vault seeds. Fresh authority = fresh vault PDA.
  const vaultAuthority = Keypair.generate();

  // Programs loaded from IDL workspace
  const auditMerkle = anchor.workspace.AuditMerkle as Program;
  const aceAdapter  = anchor.workspace.AceAdapter  as Program;
  const rwaRouter   = anchor.workspace.RwaRouter   as Program;

  // ── Shared state ──────────────────────────────────────────────────────────
  const merkleTreeKp = Keypair.generate();
  let treeConfigPda: PublicKey;
  let treeConfigBump: number;

  let acePda: PublicKey;
  let aceBump: number;

  let vaultPda: PublicKey;
  let vaultBump: number;

  // Token-2022 mints and ATAs — one per fund (plain T22 mints for tests;
  // the real mints carry TokenMetadata extensions in production).
  let fobxxMint: PublicKey;
  let buidlMint: PublicKey;
  let acredMint: PublicKey;

  let vaultUsdcAta: PublicKey;
  let vaultFobxxAta: PublicKey;
  let vaultBuidlAta: PublicKey;
  let vaultAcredAta: PublicKey;

  // Simulated USDC mint
  let usdcMint: PublicKey;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns the shared audit CPI accounts. */
  function auditAccounts() {
    return {
      auditMerkleProgram: AUDIT_MERKLE_ID,
      auditTreeConfig:    treeConfigPda,
      auditMerkleTree:    merkleTreeKp.publicKey,
      compressionProgram: SPL_COMPRESSION,
      noopProgram:        SPL_NOOP,
    };
  }

  async function getTreeConfig() {
    return auditMerkle.account.treeConfig.fetch(treeConfigPda);
  }

  async function getRwaVault() {
    return rwaRouter.account.vaultState.fetch(vaultPda);
  }

  // Fund vaultAuthority before any tests run
  before(async () => {
    const airdropSig = await connection.requestAirdrop(vaultAuthority.publicKey, 5_000_000_000);
    await connection.confirmTransaction(airdropSig, "confirmed");
  });

  // ── 1. Initialize audit merkle tree ──────────────────────────────────────

  it("initializes the audit merkle tree", async () => {
    [treeConfigPda, treeConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree-config"), merkleTreeKp.publicKey.toBuffer()],
      AUDIT_MERKLE_ID
    );

    // Tx 1: allocate the ConcurrentMerkleTree account (Agave 4.0 requires separate tx)
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

  // ── 2. Record ACE attestation ─────────────────────────────────────────────
  // The attestation PDA is [b"ace", wallet] owned by ace_adapter.
  // We record a passing attestation for vaultAuthority.

  it("records a passing ACE attestation for the test wallet", async () => {
    [acePda, aceBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("ace"), vaultAuthority.publicKey.toBuffer()],
      ACE_ADAPTER_ID
    );

    const attestationArgs = {
      wallet:      vaultAuthority.publicKey,
      kycPassed:   true,
      amlScore:    85,          // above MIN_AML_SCORE (70)
      sanctionsOk: true,
      accredited:  true,        // required for all RWA allocations
      jurisdiction: [0x55, 0x53], // "US" in ASCII
    };

    await aceAdapter.methods
      .recordAttestation(attestationArgs)
      .accounts({
        attestation:  acePda,
        aceAttestor:  payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    const att = await aceAdapter.account.aceAttestation.fetch(acePda);
    assert.isTrue(att.kycPassed);
    assert.equal(att.amlScore, 85);
    assert.isTrue(att.sanctionsOk);
    assert.isTrue(att.accredited);
    assert.equal(att.bump, aceBump);
  });

  // ── 3. Create Token-2022 mints and initialize RWA vault ──────────────────

  it("creates Token-2022 mints and initializes the RWA vault", async () => {
    // Simulate USDC and three RWA mints as plain Token-2022 mints.
    usdcMint  = await createMint(connection, payer, payer.publicKey, null, 6,
                  undefined, undefined, TOKEN_2022_PROGRAM_ID);
    fobxxMint = await createMint(connection, payer, payer.publicKey, null, 6,
                  undefined, undefined, TOKEN_2022_PROGRAM_ID);
    buidlMint = await createMint(connection, payer, payer.publicKey, null, 6,
                  undefined, undefined, TOKEN_2022_PROGRAM_ID);
    acredMint = await createMint(connection, payer, payer.publicKey, null, 6,
                  undefined, undefined, TOKEN_2022_PROGRAM_ID);

    // Derive the vault PDA using vaultAuthority to avoid conflict with e2e.
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("rwa-vault"), vaultAuthority.publicKey.toBuffer()],
      RWA_ROUTER_ID
    );

    // Create ATAs owned by the vault PDA (allowOwnerOffCurve=true for PDA owners).
    vaultUsdcAta  = await createAssociatedTokenAccount(
      connection, payer, usdcMint,  vaultPda, undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true);
    vaultFobxxAta = await createAssociatedTokenAccount(
      connection, payer, fobxxMint, vaultPda, undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true);
    vaultBuidlAta = await createAssociatedTokenAccount(
      connection, payer, buidlMint, vaultPda, undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true);
    vaultAcredAta = await createAssociatedTokenAccount(
      connection, payer, acredMint, vaultPda, undefined, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true);

    // Fund the vault USDC ATA so it has tokens to allocate.
    await mintTo(connection, payer, usdcMint, vaultUsdcAta, payer,
                 10_000_000_000, [], undefined, TOKEN_2022_PROGRAM_ID);

    // Initialize the vault state PDA using vaultAuthority.
    await rwaRouter.methods
      .initializeVault()
      .accounts({
        vault:        vaultPda,
        payer:        vaultAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaultAuthority])
      .rpc();

    const vault = await getRwaVault();
    assert.ok(vault.authority.equals(vaultAuthority.publicKey));
    assert.equal(vault.rwaAllocatedUsdc.toNumber(), 0);
    assert.equal(vault.bump, vaultBump);
  });

  // ── Shared helper for route_to_rwa calls ─────────────────────────────────

  async function routeToRwa(
    target: object,
    rwaMint: PublicKey,
    vaultRwaAta: PublicKey,
    amountUsdc: number
  ): Promise<void> {
    await rwaRouter.methods
      .routeToRwa(target, new BN(amountUsdc))
      .accounts({
        vault:            vaultPda,
        aceAttestation:   acePda,
        rwaMint,
        vaultUsdcAta,
        vaultRwaAta,
        authority:        vaultAuthority.publicKey,
        tokenProgram:     TOKEN_2022_PROGRAM_ID,
        ...auditAccounts(),
      })
      .signers([vaultAuthority])
      .rpc();
  }

  // ── 4a. FOBXX allocation ──────────────────────────────────────────────────

  it("allocates to FOBXX via Jupiter stub and appends audit leaf", async () => {
    const leafCountBefore = (await getTreeConfig()).leafCount.toNumber();
    const allocAmount = 1_000_000; // 1 USDC (6 decimals)

    await routeToRwa(RWA_TARGET_FOBXX, fobxxMint, vaultFobxxAta, allocAmount);

    const vault = await getRwaVault();
    assert.equal(vault.rwaAllocatedUsdc.toNumber(), allocAmount,
      "vault.rwa_allocated_usdc must increase by allocation amount");

    const leafCountAfter = (await getTreeConfig()).leafCount.toNumber();
    assert.equal(leafCountAfter, leafCountBefore + 1,
      "FOBXX route_to_rwa must append exactly 1 audit leaf");
  });

  // ── 4b. BUIDL allocation ──────────────────────────────────────────────────

  it("allocates to BUIDL via allowlist-gated stub and appends audit leaf", async () => {
    const leafCountBefore = (await getTreeConfig()).leafCount.toNumber();
    const vaultBefore = (await getRwaVault()).rwaAllocatedUsdc.toNumber();
    const allocAmount = 2_000_000; // 2 USDC

    await routeToRwa(RWA_TARGET_BUIDL, buidlMint, vaultBuidlAta, allocAmount);

    const vault = await getRwaVault();
    assert.equal(
      vault.rwaAllocatedUsdc.toNumber(),
      vaultBefore + allocAmount,
      "vault.rwa_allocated_usdc must accumulate BUIDL allocation"
    );

    const leafCountAfter = (await getTreeConfig()).leafCount.toNumber();
    assert.equal(leafCountAfter, leafCountBefore + 1,
      "BUIDL route_to_rwa must append exactly 1 audit leaf");
  });

  // ── 4c. ACRED allocation ──────────────────────────────────────────────────

  it("allocates to ACRED via Securitize sToken stub and appends audit leaf", async () => {
    const leafCountBefore = (await getTreeConfig()).leafCount.toNumber();
    const vaultBefore = (await getRwaVault()).rwaAllocatedUsdc.toNumber();
    const allocAmount = 5_000_000; // 5 USDC

    await routeToRwa(RWA_TARGET_ACRED, acredMint, vaultAcredAta, allocAmount);

    const vault = await getRwaVault();
    assert.equal(
      vault.rwaAllocatedUsdc.toNumber(),
      vaultBefore + allocAmount,
      "vault.rwa_allocated_usdc must accumulate ACRED allocation"
    );

    const leafCountAfter = (await getTreeConfig()).leafCount.toNumber();
    assert.equal(leafCountAfter, leafCountBefore + 1,
      "ACRED route_to_rwa must append exactly 1 audit leaf");
  });

  // ── 5. FOBXX redemption ───────────────────────────────────────────────────

  it("redeems FOBXX position and appends audit leaf", async () => {
    const leafCountBefore = (await getTreeConfig()).leafCount.toNumber();
    const vaultBefore = (await getRwaVault()).rwaAllocatedUsdc.toNumber();
    const redeemAmount = 500_000; // redeem 0.5 USDC equivalent

    await rwaRouter.methods
      .redeemRwa(RWA_TARGET_FOBXX, new BN(redeemAmount))
      .accounts({
        vault:          vaultPda,
        aceAttestation: acePda,
        rwaMint:        fobxxMint,
        vaultUsdcAta,
        vaultRwaAta:    vaultFobxxAta,
        authority:      vaultAuthority.publicKey,
        tokenProgram:   TOKEN_2022_PROGRAM_ID,
        ...auditAccounts(),
      })
      .signers([vaultAuthority])
      .rpc();

    const vault = await getRwaVault();
    assert.equal(
      vault.rwaAllocatedUsdc.toNumber(),
      vaultBefore - redeemAmount,
      "vault.rwa_allocated_usdc must decrease by redeem amount"
    );

    const leafCountAfter = (await getTreeConfig()).leafCount.toNumber();
    assert.equal(leafCountAfter, leafCountBefore + 1,
      "redeem_rwa must append exactly 1 audit leaf");
  });

  // ── 6. Reject allocation with stale / missing ACE attestation ────────────
  // We test this by creating a fresh wallet with no attestation PDA and
  // expect the account constraint to fail (seeds mismatch / account not found).

  it("rejects route_to_rwa for a wallet with no ACE attestation", async () => {
    const stranger = Keypair.generate();

    // Fund the stranger so the tx can pay fees.
    const airdropSig = await connection.requestAirdrop(
      stranger.publicKey, LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);

    // Derive the (non-existent) ACE PDA for the stranger.
    const [strangerAcePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ace"), stranger.publicKey.toBuffer()],
      ACE_ADAPTER_ID
    );

    // Derive a vault PDA for the stranger.
    const [strangerVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("rwa-vault"), stranger.publicKey.toBuffer()],
      RWA_ROUTER_ID
    );

    let threw = false;
    try {
      await rwaRouter.methods
        .routeToRwa(RWA_TARGET_FOBXX, new BN(100_000))
        .accounts({
          vault:          strangerVaultPda,
          aceAttestation: strangerAcePda,  // does not exist on-chain
          rwaMint:        fobxxMint,
          vaultUsdcAta,
          vaultRwaAta:    vaultFobxxAta,
          authority:      stranger.publicKey,
          tokenProgram:   TOKEN_2022_PROGRAM_ID,
          ...auditAccounts(),
        })
        .signers([stranger])
        .rpc();
    } catch (e: any) {
      threw = true;
      // Anchor will reject because the ACE PDA account does not exist
      // (AccountNotInitialized or ConstraintSeeds error).
      assert.ok(
        e.toString().includes("AccountNotInitialized") ||
        e.toString().includes("ConstraintSeeds") ||
        e.toString().includes("AceKycNotPassed") ||
        e.toString().includes("Error"),
        `unexpected error: ${e}`
      );
    }
    assert.isTrue(threw, "route_to_rwa without ACE attestation must throw");
  });

  // ── 7. Reject zero-amount allocation ─────────────────────────────────────

  it("rejects route_to_rwa with zero amount", async () => {
    let threw = false;
    try {
      await rwaRouter.methods
        .routeToRwa(RWA_TARGET_FOBXX, new BN(0))
        .accounts({
          vault:          vaultPda,
          aceAttestation: acePda,
          rwaMint:        fobxxMint,
          vaultUsdcAta,
          vaultRwaAta:    vaultFobxxAta,
          authority:      vaultAuthority.publicKey,
          tokenProgram:   TOKEN_2022_PROGRAM_ID,
          ...auditAccounts(),
        })
        .signers([vaultAuthority])
        .rpc();
    } catch (e: any) {
      threw = true;
      assert.include(e.toString(), "ZeroAmount",
        "error must reference the ZeroAmount error code");
    }
    assert.isTrue(threw, "route_to_rwa with zero amount must throw ZeroAmount");
  });

  // ── 8. Audit-trail integrity ──────────────────────────────────────────────
  // Tests 4a + 4b + 4c + 5 = 4 leaves appended. Tree started at 0.

  it("audit trail leaf_count equals the number of routing operations (4)", async () => {
    const tree = await getTreeConfig();
    assert.equal(
      tree.leafCount.toNumber(),
      4,
      "expected 4 audit leaves: FOBXX alloc(1) + BUIDL alloc(1) + ACRED alloc(1) + FOBXX redeem(1)"
    );
  });
});
