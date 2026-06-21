/**
 * Compliance API — Jest test suite
 *
 * Covers:
 *   POST /v1/compliance/verify-trade  → approved path
 *   POST /v1/compliance/verify-trade  → rejected path (KYC fail)
 *   POST /v1/compliance/verify-trade  → ACE-fail path (attestation missing)
 *   GET  /v1/audit/export             → returns expected leaf structure
 *
 * All Solana RPC calls are mocked — no mainnet/devnet traffic.
 */

import request from "supertest";
import { Connection, PublicKey } from "@solana/web3.js";
import app from "../server";

// ─── Mock @solana/web3.js Connection ─────────────────────────────────────────

// We mock the Connection class at the module level so every import in the
// route files gets the same mock instance.
jest.mock("@solana/web3.js", () => {
  const actual = jest.requireActual<typeof import("@solana/web3.js")>("@solana/web3.js");

  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      getAccountInfo:          jest.fn(),
      getSlot:                 jest.fn().mockResolvedValue(312_481_944),
      getLatestBlockhash:      jest.fn().mockResolvedValue({
        blockhash: "mockblockhash111111111111111111111111111111",
        lastValidBlockHeight: 999_999,
      }),
      getSignaturesForAddress: jest.fn().mockResolvedValue([]),
      getParsedTransaction:    jest.fn().mockResolvedValue(null),
    })),
  };
});

// ─── Helpers: build mock account data buffers ─────────────────────────────────

/**
 * Build an AceAttestation account buffer.
 * Layout: [8 disc][32 wallet][1 kyc][1 aml][1 sanctions][1 accredited]
 *         [2 jurisdiction][8 verified_at][32 ace_attestor][1 bump] = 87 bytes
 */
function buildAceBuffer({
  kyc = true,
  aml = 10,
  sanctions = true,
  accredited = true,
  verifiedAt = Math.floor(Date.now() / 1000) - 60, // 1 min ago — fresh
  walletBytes = Buffer.alloc(32, 0xaa),
}: {
  kyc?: boolean;
  aml?: number;
  sanctions?: boolean;
  accredited?: boolean;
  verifiedAt?: number;
  walletBytes?: Buffer;
} = {}): Buffer {
  const buf = Buffer.alloc(87, 0);
  // discriminator (8) — arbitrary bytes
  buf.write("aceattes", 0, "ascii");
  // wallet (32)
  walletBytes.copy(buf, 8);
  let offset = 40;
  buf[offset++] = kyc ? 1 : 0;
  buf[offset++] = aml;
  buf[offset++] = sanctions ? 1 : 0;
  buf[offset++] = accredited ? 1 : 0;
  // jurisdiction (2)
  buf.writeUInt16LE(840, offset); offset += 2; // 840 = USA
  // verified_at (i64 LE, 8 bytes)
  buf.writeBigInt64LE(BigInt(verifiedAt), offset); offset += 8;
  // ace_attestor (32) + bump (1) — leave as zero
  return buf;
}

/**
 * Build a ZkmlScore account buffer.
 * Layout: [8 disc][32 vault][2 score_bps][1 frozen][32 proof_hash]
 *         [8 verified_at][1 bump] = 84 bytes
 */
function buildZkmlBuffer({
  scoreBps = 1_800,  // 0.18 — well below 8 500 freeze threshold
  frozen = false,
  proofHashBytes = Buffer.alloc(32, 0xbb),
  verifiedAt = Math.floor(Date.now() / 1000) - 300,
}: {
  scoreBps?: number;
  frozen?: boolean;
  proofHashBytes?: Buffer;
  verifiedAt?: number;
} = {}): Buffer {
  const buf = Buffer.alloc(84, 0);
  // discriminator (8)
  buf.write("zkmlscor", 0, "ascii");
  // vault (32)
  buf.fill(0xcc, 8, 40);
  let offset = 40;
  buf.writeUInt16LE(scoreBps, offset); offset += 2;
  buf[offset++] = frozen ? 1 : 0;
  proofHashBytes.copy(buf, offset); offset += 32;
  buf.writeBigInt64LE(BigInt(verifiedAt), offset);
  return buf;
}

/**
 * Build a TreeConfig account buffer.
 * Layout: [8 disc][32 merkle_tree][32 authority][8 leaf_count][1 bump] = 81 bytes
 */
function buildTreeConfigBuffer(leafCount: bigint, merkleTree: Buffer): Buffer {
  const buf = Buffer.alloc(81, 0);
  buf.write("treecfg_", 0, "ascii");
  merkleTree.copy(buf, 8);
  buf.fill(0xdd, 40, 72); // authority
  buf.writeBigUInt64LE(leafCount, 72);
  return buf;
}

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const VALID_WALLET = new PublicKey("11111111111111111111111111111111");
const API_KEY      = process.env.ANCHORAGE_API_KEY ?? "zk_test_anchorage";

const VALID_TRADE_BODY = {
  wallet:          VALID_WALLET.toBase58(),
  instruction:     "SWAP" as const,
  asset_pair:      ["SOL", "USDC"] as [string, string],
  notional_usd:    250_000,
  advisor_id:      "J.Harrington.CFA",
  ace_attestation: "ace_proof_abc123",
};

// ─── POST /v1/compliance/verify-trade — APPROVED PATH ────────────────────────

describe("POST /v1/compliance/verify-trade", () => {
  let mockGetAccountInfo: jest.Mock;

  beforeEach(() => {
    // Access the mocked Connection instance that the route module uses.
    // Since jest.mock is hoisted, all `new Connection(...)` calls return the mock.
    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    const instance = MockConnection.mock.instances[0];
    if (instance) {
      mockGetAccountInfo = instance.getAccountInfo as jest.Mock;
    } else {
      // Fallback: set on prototype so next instantiation picks it up
      mockGetAccountInfo = jest.fn();
      MockConnection.prototype.getAccountInfo = mockGetAccountInfo;
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns approved=true when all ACE and ZKML gates pass", async () => {
    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockImplementation(async (pda: PublicKey) => {
        const pdaStr = pda.toBase58();
        // First call → AceAttestation; second call → ZkmlScore
        // We distinguish by checking which PDA was requested (or just return
        // the right buffer based on call order)
        if ((MockConnection.prototype.getAccountInfo as jest.Mock).mock.calls.length === 1) {
          return { data: buildAceBuffer(), executable: false, lamports: 1_000_000, owner: new PublicKey("ACExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") };
        }
        return { data: buildZkmlBuffer({ scoreBps: 1_800 }), executable: false, lamports: 1_000_000, owner: new PublicKey("Ro111111111111111111111111111111111111111111") };
      });

    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send(VALID_TRADE_BODY)
      .expect(200);

    expect(res.body.approved).toBe(true);
    expect(typeof res.body.zkml_score).toBe("number");
    expect(res.body.zkml_score).toBeLessThan(0.85);
    expect(res.body).toHaveProperty("proof_hash");
    expect(res.body).toHaveProperty("merkle_root");
    expect(res.body).toHaveProperty("slot");
    expect(res.body).toHaveProperty("finality_ms");
    expect(res.body).toHaveProperty("audit_entry_id");
    expect(res.body.audit_entry_id).toMatch(/^AUD-\d+$/);
  });

  // ─── REJECTED PATH: KYC fail ──────────────────────────────────────────────

  it("returns 403 with reason=kyc_failed when KYC flag is false", async () => {
    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockResolvedValueOnce({
        data:       buildAceBuffer({ kyc: false }),
        executable: false,
        lamports:   1_000_000,
        owner:      new PublicKey("ACExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
      });

    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send(VALID_TRADE_BODY)
      .expect(403);

    expect(res.body.error).toBe("ace_attestation_failed");
    expect(res.body.reason).toBe("kyc_failed");
    expect(res.body.approved).toBe(false);
    // ZKML score should not be present (we never got there)
    expect(res.body.zkml_score).toBeNull();
  });

  // ─── ACE-FAIL PATH: attestation missing ───────────────────────────────────

  it("returns 403 with ACE attestation error when account does not exist", async () => {
    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockResolvedValueOnce(null); // PDA not found

    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send(VALID_TRADE_BODY)
      .expect(403);

    expect(res.body.error).toBe("ace_attestation_failed");
    expect(res.body.approved).toBe(false);
    expect(res.body.reason).toMatch(/attestation/i);
  });

  // ─── Additional guard: ZKML frozen path ──────────────────────────────────

  it("returns 403 with reason=vault_frozen when frozen flag is set", async () => {
    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    // First call: valid ACE; second call: frozen ZkmlScore
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockResolvedValueOnce({
        data:       buildAceBuffer(),
        executable: false,
        lamports:   1_000_000,
        owner:      new PublicKey("ACExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
      })
      .mockResolvedValueOnce({
        data:       buildZkmlBuffer({ frozen: true, scoreBps: 9_000 }),
        executable: false,
        lamports:   1_000_000,
        owner:      new PublicKey("Ro111111111111111111111111111111111111111111"),
      });

    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send(VALID_TRADE_BODY)
      .expect(403);

    expect(res.body.error).toBe("account_frozen");
    expect(res.body.reason).toBe("vault_frozen");
    expect(res.body.approved).toBe(false);
  });

  // ─── Field validation ─────────────────────────────────────────────────────

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send({ wallet: VALID_WALLET.toBase58() }) // missing instruction, notional_usd, ace_attestation
      .expect(400);

    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("instruction");
  });

  it("returns 400 for an invalid wallet address", async () => {
    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .set("x-api-key", API_KEY)
      .send({ ...VALID_TRADE_BODY, wallet: "not-a-pubkey" })
      .expect(400);

    expect(res.body.error).toBe("invalid_wallet");
  });

  it("returns 401 when no API key is provided", async () => {
    const res = await request(app)
      .post("/v1/compliance/verify-trade")
      .send(VALID_TRADE_BODY)
      .expect(401);

    expect(res.body.error).toBe("unauthorized");
  });
});

// ─── GET /v1/audit/export ─────────────────────────────────────────────────────

describe("GET /v1/audit/export", () => {
  const VAULT = new PublicKey("11111111111111111111111111111112");

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns expected leaf structure when noop logs contain ChangeLogEvents", async () => {
    const merkleTreeBuf = Buffer.from(VAULT.toBytes());
    const treeConfigData = buildTreeConfigBuffer(BigInt(3), merkleTreeBuf);

    // Build a minimal ChangeLogEvent v1 payload for one leaf (index=1)
    const changeLog = buildChangeLogEvent({ index: 1, leafHash: Buffer.alloc(32, 0xfe) });
    // Encode as base58 for the mock instruction data field
    const changeLogBase58 = encodeBase58(changeLog);

    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockResolvedValueOnce({
        data:       treeConfigData,
        executable: false,
        lamports:   1_000_000,
        owner:      new PublicKey("Am111111111111111111111111111111111111111111"),
      });

    MockConnection.prototype.getSignaturesForAddress = jest
      .fn()
      .mockResolvedValueOnce([
        { signature: "sig1111111111111111111111111111111111111111111111111111111111111111", slot: 312_481_900, err: null, memo: null, blockTime: null, confirmationStatus: "finalized" },
      ]);

    MockConnection.prototype.getParsedTransaction = jest
      .fn()
      .mockResolvedValueOnce({
        slot: 312_481_900,
        meta: {
          innerInstructions: [
            {
              index: 0,
              instructions: [
                {
                  programId: new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
                  data:      changeLogBase58,
                },
              ],
            },
          ],
        },
      });

    const res = await request(app)
      .get("/v1/audit/export")
      .set("x-api-key", API_KEY)
      .query({
        advisor:   "J.Harrington.CFA",
        vault:     VAULT.toBase58(),
        from_leaf: 0,
        to_leaf:   9,
      })
      .expect(200);

    expect(res.body).toHaveProperty("root");
    expect(res.body).toHaveProperty("leaf_count");
    expect(typeof res.body.leaf_count).toBe("number");
    expect(res.body).toHaveProperty("leaves");
    expect(Array.isArray(res.body.leaves)).toBe(true);

    const leaves = res.body.leaves as { index: number; hash: string; slot: number }[];
    // One leaf at index 1 should have been parsed from the noop log
    expect(leaves.length).toBeGreaterThanOrEqual(1);
    const leaf = leaves.find((l) => l.index === 1);
    if (leaf) {
      expect(leaf.hash).toBe(Buffer.alloc(32, 0xfe).toString("hex"));
      expect(leaf.slot).toBe(312_481_900);
    }
  });

  it("returns empty leaves array when no noop transactions found", async () => {
    const merkleTreeBuf = Buffer.from(VAULT.toBytes());
    const treeConfigData = buildTreeConfigBuffer(BigInt(0), merkleTreeBuf);

    const MockConnection = Connection as jest.MockedClass<typeof Connection>;
    MockConnection.prototype.getAccountInfo = jest
      .fn()
      .mockResolvedValueOnce({
        data:       treeConfigData,
        executable: false,
        lamports:   1_000_000,
        owner:      new PublicKey("Am111111111111111111111111111111111111111111"),
      });

    MockConnection.prototype.getSignaturesForAddress = jest
      .fn()
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/v1/audit/export")
      .set("x-api-key", API_KEY)
      .query({ advisor: "J.Harrington.CFA", vault: VAULT.toBase58() })
      .expect(200);

    expect(res.body.leaves).toEqual([]);
    expect(res.body.leaf_count).toBe(0);
    expect(res.body.advisor).toBe("J.Harrington.CFA");
    expect(res.body.format).toBe("SEC-17a-4");
  });

  it("returns 400 when advisor is missing", async () => {
    const res = await request(app)
      .get("/v1/audit/export")
      .set("x-api-key", API_KEY)
      .query({ vault: VAULT.toBase58() })
      .expect(400);

    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("advisor");
  });

  it("returns 400 when vault is missing", async () => {
    const res = await request(app)
      .get("/v1/audit/export")
      .set("x-api-key", API_KEY)
      .query({ advisor: "J.Harrington.CFA" })
      .expect(400);

    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("vault");
  });

  it("returns 400 when vault is an invalid public key", async () => {
    const res = await request(app)
      .get("/v1/audit/export")
      .set("x-api-key", API_KEY)
      .query({ advisor: "J.Harrington.CFA", vault: "not-a-key" })
      .expect(400);

    expect(res.body.error).toBe("invalid_vault");
  });
});

// ─── GET /v1/health (sanity) ──────────────────────────────────────────────────

describe("GET /v1/health", () => {
  it("returns 200 with status ok (no auth required)", async () => {
    const res = await request(app).get("/v1/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.chain).toBe("solana-mainnet");
  });
});

// ─── Test utility: build a ChangeLogEvent v1 binary buffer ───────────────────

function buildChangeLogEvent({
  index,
  leafHash,
  seq = BigInt(1),
  treeId = Buffer.alloc(32, 0xaa),
}: {
  index: number;
  leafHash: Buffer;
  seq?: bigint;
  treeId?: Buffer;
}): Buffer {
  // version(1) + id(32) + seq(8) + index(4) + path[0]=leafHash(32)
  const buf = Buffer.alloc(77, 0);
  let offset = 0;
  buf[offset++] = 1; // version
  treeId.copy(buf, offset); offset += 32;
  buf.writeBigUInt64LE(seq, offset); offset += 8;
  buf.writeUInt32LE(index, offset); offset += 4;
  leafHash.copy(buf, offset);
  return buf;
}

/** Minimal base58 encoder for test payloads (mirrors the decoder in exportAudit.ts). */
function encodeBase58(input: Buffer): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let digits = [0];
  for (let i = 0; i < input.length; i++) {
    let carry = input[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (let i = 0; i < input.length && input[i] === 0; i++) result += "1";
  for (let i = digits.length - 1; i >= 0; i--) result += ALPHABET[digits[i]];
  return result;
}
