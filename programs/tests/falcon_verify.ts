/**
 * falcon_verify — Initiative 06 integration tests
 *
 * Run with: anchor test --skip-deploy
 *
 * Test suite:
 *   1. initialize_keyring — creates the SigningKeyring PDA, appends audit leaf
 *   2. verify_signature — Dilithium-3 path passes (stub returns true)
 *   3. verify_signature — wrong signature length → BadSignatureLength error
 *   4. verify_signature — wrong public-key length → BadPublicKeyLength error
 *   5. rotate_signing_key — old key authorizes new key; PDA updated; audit leaf appended
 *   6. rotate_signing_key — unauthorized rotation rejected (RotationNotAuthorized)
 *   7. Falcon-512 verify_signature → FalconNotYetSupported (no simd-0416 feature)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getConcurrentMerkleTreeAccountSize,
} from "@solana/spl-account-compression";
import { assert } from "chai";

// Program IDs from Anchor.toml [programs.localnet]
const AUDIT_MERKLE_ID  = new PublicKey("86GxUKYc4kxmmi8raLPorRy9kobNgYn4YYwzpjdPk5UM");
const FALCON_VERIFY_ID = new PublicKey("CCFsAnMbTkuoBE2WkQFz5dANybWjCcNmHbPrV4A9T3oR");
const SPL_COMPRESSION  = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const SPL_NOOP         = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

const DILITHIUM3_SIG_LEN  = 2420;
const DILITHIUM3_PK_LEN   = 1312;
const FALCON512_SIG_LEN   = 690;
const FALCON512_PK_LEN    = 897;

const MAX_DEPTH       = 20;
const MAX_BUFFER_SIZE = 64;

const SIG_TYPE_DILITHIUM3 = { dilithium3: {} };
const SIG_TYPE_FALCON512  = { falcon512: {}  };

// PqBuffer write chunk size — must fit inside Solana's 1232-byte tx limit.
const CHUNK = 900;

describe("falcon_verify — Initiative 06", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const auditMerkle  = anchor.workspace.AuditMerkle  as Program;
  const falconVerify = anchor.workspace.FalconVerify as Program;

  // Dedicated authority for this test suite — avoids PDA conflicts with
  // e2e_integration which uses payer.publicKey for PqBuffer/keyring seeds.
  const testAuthority = Keypair.generate();

  // ── Shared state ────────────────────────────────────────────────────────────
  const merkleTreeKp = Keypair.generate();
  let treeConfigPda: PublicKey;
  let treeConfigBump: number;
  let keyringPda: PublicKey;

  // PqBuffer PDAs — each (authority, slot) pair is a unique PDA.
  // slot 0: standard Dilithium-3 pk (1312 bytes)
  // slot 1: standard Dilithium-3 sig (2420 bytes)
  // slot 2: new-key for rotate (1312 bytes)
  // slot 3: auth-sig for rotate (2420 bytes)
  // slot 4: bad sig — 100 bytes (wrong length, for test 3)
  // slot 5: bad pk  — 64 bytes  (wrong length, for test 4)
  // slot 6: Falcon-512 pk (897 bytes)
  // slot 7: Falcon-512 sig (690 bytes)
  let pkBufPda: PublicKey;
  let sigBufPda: PublicKey;
  let newKeyBufPda: PublicKey;
  let authSigBufPda: PublicKey;
  let badSigBufPda: PublicKey;
  let badPkBufPda: PublicKey;
  let falconPkBufPda: PublicKey;
  let falconSigBufPda: PublicKey;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function auditAccounts() {
    return {
      auditTreeConfig:    treeConfigPda,
      auditMerkleTree:    merkleTreeKp.publicKey,
      auditMerkleProgram: AUDIT_MERKLE_ID,
      compressionProgram: SPL_COMPRESSION,
      noopProgram:        SPL_NOOP,
    };
  }

  async function getTreeConfig() {
    return auditMerkle.account.treeConfig.fetch(treeConfigPda);
  }

  async function getLeafCount(): Promise<number> {
    const cfg = await getTreeConfig();
    return (cfg.leafCount as BN).toNumber();
  }

  function pqBufPda(slot: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pq-buf"), testAuthority.publicKey.toBuffer(), Buffer.from([slot])],
      FALCON_VERIFY_ID,
    );
    return pda;
  }

  async function initBuffer(slot: number): Promise<PublicKey> {
    const pda = pqBufPda(slot);
    await falconVerify.methods
      .initPqBuffer(slot)
      .accounts({ buffer: pda, authority: testAuthority.publicKey, systemProgram: SystemProgram.programId })
      .signers([testAuthority])
      .rpc();
    return pda;
  }

  async function writeBuffer(bufPda: PublicKey, data: Buffer): Promise<void> {
    for (let off = 0; off < data.length; off += CHUNK) {
      const chunk = data.slice(off, Math.min(off + CHUNK, data.length));
      await falconVerify.methods
        .writePqBuffer(chunk, off)
        .accounts({ buffer: bufPda, authority: testAuthority.publicKey })
        .signers([testAuthority])
        .rpc();
    }
  }

  // ── 0. Initialize audit merkle tree + all PqBuffers ──────────────────────────

  before("initializes the audit merkle tree and PqBuffer PDAs", async () => {
    // Fund the dedicated test authority
    const airdropSig = await connection.requestAirdrop(testAuthority.publicKey, 10_000_000_000);
    await connection.confirmTransaction(airdropSig, "confirmed");

    [treeConfigPda, treeConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree-config"), merkleTreeKp.publicKey.toBuffer()],
      AUDIT_MERKLE_ID,
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
    assert.equal((cfg.leafCount as BN).toNumber(), 0);

    // Create and fill all PqBuffer PDAs used across the tests.
    pkBufPda       = await initBuffer(0);
    sigBufPda      = await initBuffer(1);
    newKeyBufPda   = await initBuffer(2);
    authSigBufPda  = await initBuffer(3);
    badSigBufPda   = await initBuffer(4);
    badPkBufPda    = await initBuffer(5);
    falconPkBufPda = await initBuffer(6);
    falconSigBufPda = await initBuffer(7);

    await writeBuffer(pkBufPda,        Buffer.alloc(DILITHIUM3_PK_LEN,  0xab));
    await writeBuffer(sigBufPda,       Buffer.alloc(DILITHIUM3_SIG_LEN, 0xcd));
    await writeBuffer(newKeyBufPda,    Buffer.alloc(DILITHIUM3_PK_LEN,  0x99));
    await writeBuffer(authSigBufPda,   Buffer.alloc(DILITHIUM3_SIG_LEN, 0x77));
    await writeBuffer(badSigBufPda,    Buffer.alloc(100,                0xff)); // wrong length
    await writeBuffer(badPkBufPda,     Buffer.alloc(64,                 0xff)); // wrong length
    await writeBuffer(falconPkBufPda,  Buffer.alloc(FALCON512_PK_LEN,   0xef));
    await writeBuffer(falconSigBufPda, Buffer.alloc(FALCON512_SIG_LEN,  0x12));
  });

  // ── 1. initialize_keyring ────────────────────────────────────────────────────

  it("1. initialize_keyring creates SigningKeyring PDA and appends audit leaf", async () => {
    [keyringPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("keyring"), testAuthority.publicKey.toBuffer()],
      FALCON_VERIFY_ID,
    );

    const leafCountBefore = await getLeafCount();

    await falconVerify.methods
      .initializeKeyring(SIG_TYPE_DILITHIUM3)
      .accounts({
        keyring:       keyringPda,
        authority:     testAuthority.publicKey,
        systemProgram: SystemProgram.programId,
        keyBuffer:     pkBufPda,
        ...auditAccounts(),
      })
      .signers([testAuthority])
      .rpc();

    const keyring = await falconVerify.account.signingKeyring.fetch(keyringPda);
    assert.ok(keyring.authority.equals(testAuthority.publicKey), "authority mismatch");
    assert.deepEqual(keyring.keyType, SIG_TYPE_DILITHIUM3, "key_type should be Dilithium3");
    assert.equal(keyring.publicKey.length, DILITHIUM3_PK_LEN, "public_key wrong length");
    assert.equal(keyring.rotationCount, 0, "rotation_count should start at 0");

    const leafCountAfter = await getLeafCount();
    assert.equal(leafCountAfter, leafCountBefore + 1, "audit leaf not appended");
  });

  // ── 2. verify_signature — valid Dilithium-3 ──────────────────────────────────

  it("2. verify_signature passes for correctly-sized Dilithium-3 sig/pk (stub)", async () => {
    const msg = Buffer.from("zynt-protocol-test-message");

    await falconVerify.methods
      .verifySignature(SIG_TYPE_DILITHIUM3, msg)
      .accounts({
        signer:    testAuthority.publicKey,
        sigBuffer: sigBufPda,
        pkBuffer:  pkBufPda,
      })
      .signers([testAuthority])
      .rpc();
  });

  // ── 3. verify_signature — wrong sig length → BadSignatureLength ───────────────

  it("3. verify_signature rejects Dilithium-3 sig with wrong length", async () => {
    const msg = Buffer.from("zynt-test");

    try {
      await falconVerify.methods
        .verifySignature(SIG_TYPE_DILITHIUM3, msg)
        .accounts({
          signer:    testAuthority.publicKey,
          sigBuffer: badSigBufPda, // 100 bytes — wrong length
          pkBuffer:  pkBufPda,
        })
        .signers([testAuthority])
        .rpc();
      assert.fail("Expected BadSignatureLength error");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "BadSignatureLength",
        `Expected BadSignatureLength, got: ${err}`,
      );
    }
  });

  // ── 4. verify_signature — wrong pk length → BadPublicKeyLength ───────────────

  it("4. verify_signature rejects Dilithium-3 pk with wrong length", async () => {
    const msg = Buffer.from("zynt-test");

    try {
      await falconVerify.methods
        .verifySignature(SIG_TYPE_DILITHIUM3, msg)
        .accounts({
          signer:    testAuthority.publicKey,
          sigBuffer: sigBufPda,
          pkBuffer:  badPkBufPda, // 64 bytes — wrong length
        })
        .signers([testAuthority])
        .rpc();
      assert.fail("Expected BadPublicKeyLength error");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "BadPublicKeyLength",
        `Expected BadPublicKeyLength, got: ${err}`,
      );
    }
  });

  // ── 5. rotate_signing_key — authorized rotation ───────────────────────────────

  it("5. rotate_signing_key updates keyring PDA and appends audit leaf", async () => {
    const leafCountBefore = await getLeafCount();

    await falconVerify.methods
      .rotateSigningKey(SIG_TYPE_DILITHIUM3)
      .accounts({
        keyring:       keyringPda,
        authority:     testAuthority.publicKey,
        newKeyBuffer:  newKeyBufPda,
        authSigBuffer: authSigBufPda,
        ...auditAccounts(),
      })
      .signers([testAuthority])
      .rpc();

    const keyring = await falconVerify.account.signingKeyring.fetch(keyringPda);
    assert.deepEqual(keyring.keyType, SIG_TYPE_DILITHIUM3, "key_type mismatch after rotation");
    assert.equal(keyring.rotationCount, 1, "rotation_count should be 1 after first rotation");
    assert.equal(keyring.publicKey.length, DILITHIUM3_PK_LEN);
    assert.equal(keyring.publicKey[0], 0x99, "new pk not stored correctly");

    const leafCountAfter = await getLeafCount();
    assert.equal(leafCountAfter, leafCountBefore + 1, "audit leaf not appended on rotation");
  });

  // ── 6. rotate_signing_key — unauthorized (wrong authority) ────────────────────

  it("6. rotate_signing_key rejects when authority does not own the keyring", async () => {
    const rogue = Keypair.generate();
    const sig = await connection.requestAirdrop(rogue.publicKey, 1_000_000_000);
    await connection.confirmTransaction(sig, "confirmed");

    try {
      // keyringPda is owned by testAuthority; authority is rogue → has_one fails
      await falconVerify.methods
        .rotateSigningKey(SIG_TYPE_DILITHIUM3)
        .accounts({
          keyring:       keyringPda,
          authority:     rogue.publicKey,
          newKeyBuffer:  newKeyBufPda,
          authSigBuffer: authSigBufPda,
          ...auditAccounts(),
        })
        .signers([rogue])
        .rpc();
      assert.fail("Expected RotationNotAuthorized error");
    } catch (err: any) {
      assert.ok(
        err.toString().includes("RotationNotAuthorized") ||
        err.toString().includes("ConstraintHasOne") ||
        err.toString().includes("ConstraintSeeds") ||
        err.toString().includes("PqBufferNotOwned") ||
        err.toString().includes("2003") ||
        err.toString().includes("2006"),
        `Expected authorization error, got: ${err}`,
      );
    }
  });

  // ── 7. Falcon-512 → FalconNotYetSupported (no simd-0416 feature) ─────────────

  it("7. verify_signature returns FalconNotYetSupported for Falcon-512 without simd-0416", async () => {
    const msg = Buffer.from("zynt-falcon-test");

    try {
      await falconVerify.methods
        .verifySignature(SIG_TYPE_FALCON512, msg)
        .accounts({
          signer:    testAuthority.publicKey,
          sigBuffer: falconSigBufPda,
          pkBuffer:  falconPkBufPda,
        })
        .signers([testAuthority])
        .rpc();
      assert.fail("Expected FalconNotYetSupported error");
    } catch (err: any) {
      assert.include(
        err.toString(),
        "FalconNotYetSupported",
        `Expected FalconNotYetSupported, got: ${err}`,
      );
    }
  });
});
