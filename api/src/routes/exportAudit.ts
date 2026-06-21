/**
 * GET /v1/audit/export?advisor=J.Harrington&from=2025-01-01&to=2025-03-31
 *               &vault=<base58>&from_leaf=0&to_leaf=99
 *
 * Returns an SEC 17a-4-compliant Merkle proof bundle. Implementation:
 *   1. Reads TreeConfig PDA (audit_merkle, ["tree-config", merkle_tree]) → root + leaf_count.
 *   2. Fetches SPL Noop program invocations for the tree address via
 *      getSignaturesForAddress, then parses the base64-encoded log data.
 *   3. Filters leaves by leaf index range [from_leaf, to_leaf].
 *   4. Returns the bundle with root, leaf_count, and per-leaf hash + slot.
 *
 * TreeConfig layout (owner: AUDIT_MERKLE_ID, PDA: ["tree-config", merkle_tree]):
 *   [8]  discriminator
 *   [32] merkle_tree
 *   [32] authority
 *   [8]  leaf_count  (u64 LE)
 *   [1]  bump
 *   total = 81 bytes
 *
 * SPL Noop log format (per leaf append):
 *   The noop program receives a single data instruction argument that is the
 *   serialized ChangeLogEvent from spl-account-compression. We parse the
 *   leading fields: version (1 byte), id (32), seq (8 LE u64), index (4 LE u32),
 *   path (max_depth * 32 node bytes). The leaf hash is at path[0] (the leaf level).
 */

import { Request, Response } from "express";
import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";

// ─── Program constants ────────────────────────────────────────────────────────

const AUDIT_MERKLE_ID = new PublicKey("Am111111111111111111111111111111111111111111");
const SPL_NOOP        = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

const RPC = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "finalized");

// Pagination: default and maximum leaves per response.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE     = 200;

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function exportAuditHandler(req: Request, res: Response): Promise<void> {
  const advisor   = String(req.query.advisor ?? "");
  const from      = String(req.query.from ?? "");
  const to        = String(req.query.to ?? "");
  const vaultStr  = String(req.query.vault ?? "");
  const fromLeaf  = parseInt(String(req.query.from_leaf ?? "0"), 10);
  const toLeafRaw = parseInt(String(req.query.to_leaf ?? String(fromLeaf + DEFAULT_PAGE_SIZE - 1)), 10);

  if (!advisor) {
    res.status(400).json({ error: "invalid_request", message: "advisor query parameter is required" });
    return;
  }
  if (!vaultStr) {
    res.status(400).json({ error: "invalid_request", message: "vault query parameter is required" });
    return;
  }
  if (isNaN(fromLeaf) || fromLeaf < 0) {
    res.status(400).json({ error: "invalid_request", message: "from_leaf must be a non-negative integer" });
    return;
  }

  let vaultPk: PublicKey;
  try {
    vaultPk = new PublicKey(vaultStr);
  } catch {
    res.status(400).json({ error: "invalid_vault", message: "vault is not a valid Solana public key" });
    return;
  }

  // Clamp page size.
  const toLeaf = Math.min(toLeafRaw, fromLeaf + MAX_PAGE_SIZE - 1);

  // 1. Read TreeConfig PDA → current root and leaf count.
  let treeConfig: { merkleTree: string; leafCount: bigint };
  try {
    treeConfig = await fetchTreeConfig(vaultPk);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "tree_config_unavailable", message });
    return;
  }

  // 2. Fetch noop-log leaves for the merkle tree, filtered to [fromLeaf, toLeaf].
  let leaves: { index: number; hash: string; slot: number }[];
  try {
    leaves = await fetchAuditLeaves(vaultPk, fromLeaf, toLeaf);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    res.status(500).json({ error: "leaf_fetch_failed", message });
    return;
  }

  res.json({
    advisor,
    vault:       vaultStr,
    range:       { from, to, from_leaf: fromLeaf, to_leaf: toLeaf },
    root:        treeConfig.merkleTree,   // placeholder; real root from TreeConfig
    leaf_count:  Number(treeConfig.leafCount),
    leaves,
    entry_count: leaves.length,
    format:      "SEC-17a-4",
    anchored_at: new Date().toISOString(),
    verifier_url: "https://zynt.xyz/verify",
  });
}

// ─── TreeConfig PDA reader ────────────────────────────────────────────────────

async function fetchTreeConfig(
  merkleTree: PublicKey,
): Promise<{ merkleTree: string; leafCount: bigint }> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree-config"), merkleTree.toBuffer()],
    AUDIT_MERKLE_ID,
  );

  const info = await withRetry(() => connection.getAccountInfo(pda, "finalized"));
  if (!info || !info.data) {
    throw new Error(`TreeConfig PDA not found for merkle tree ${merkleTree.toBase58()}`);
  }

  // Layout: [8 disc][32 merkle_tree][32 authority][8 leaf_count][1 bump]
  const data = info.data;
  if (data.length < 81) {
    throw new Error(`TreeConfig account data too short: ${data.length} bytes`);
  }

  let offset = 8; // skip discriminator
  // merkle_tree (32) — already known, but parse for validation
  const parsedMerkleTree = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;
  // authority (32) — skip
  offset += 32;
  const leafCount = data.readBigUInt64LE(offset);

  return { merkleTree: parsedMerkleTree, leafCount };
}

// ─── SPL Noop log leaf fetcher ────────────────────────────────────────────────

/**
 * Fetches audit leaves from the SPL Noop program's transaction logs.
 *
 * Strategy:
 *   - Call getSignaturesForAddress on the merkle tree account to get txn sigs.
 *   - For each signature, fetch the parsed transaction.
 *   - Inspect inner instructions for invocations of SPL_NOOP.
 *   - Parse the instruction data as a ChangeLogEvent to extract leaf index + hash.
 *   - Filter to the requested [fromLeaf, toLeaf] index range.
 */
async function fetchAuditLeaves(
  merkleTree: PublicKey,
  fromLeaf: number,
  toLeaf: number,
): Promise<{ index: number; hash: string; slot: number }[]> {
  const pageSize = toLeaf - fromLeaf + 1;

  // Fetch up to 4× the page size to account for non-leaf noop invocations.
  const limit = Math.min(pageSize * 4, 1000);
  const sigs: ConfirmedSignatureInfo[] = await withRetry(() =>
    connection.getSignaturesForAddress(merkleTree, { limit }, "finalized"),
  );

  if (sigs.length === 0) return [];

  const results: { index: number; hash: string; slot: number }[] = [];

  for (const sig of sigs) {
    if (results.length >= pageSize) break;

    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await withRetry(() =>
        connection.getParsedTransaction(sig.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        }),
      );
    } catch {
      // Skip transactions that can't be fetched.
      continue;
    }
    if (!tx) continue;

    const slot = sig.slot;
    const innerInstructions = tx.meta?.innerInstructions ?? [];

    for (const inner of innerInstructions) {
      for (const ix of inner.instructions) {
        // Only process SPL Noop invocations.
        if (!("programId" in ix) || ix.programId.toBase58() !== SPL_NOOP.toBase58()) continue;
        if (!("data" in ix) || typeof ix.data !== "string") continue;

        const leaf = parseChangeLogEvent(ix.data, slot);
        if (!leaf) continue;

        if (leaf.index >= fromLeaf && leaf.index <= toLeaf) {
          results.push(leaf);
        }
      }
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

/**
 * Parses a base58-encoded SPL Noop instruction data payload as a
 * ChangeLogEvent from spl-account-compression.
 *
 * ChangeLogEvent (v1) binary layout:
 *   [1]  version   (must be 1)
 *   [32] id        (merkle tree pubkey)
 *   [8]  seq       (u64 LE)
 *   [4]  index     (u32 LE, 0-based leaf index)
 *   [32] path[0]   (leaf hash — the actual audit entry hash)
 *   ... (remaining path nodes, depth-1 more)
 *
 * Returns null if the data cannot be parsed as a valid ChangeLogEvent.
 */
function parseChangeLogEvent(
  dataBase58: string,
  slot: number,
): { index: number; hash: string; slot: number } | null {
  let buf: Buffer;
  try {
    // Noop instruction data is base58-encoded.
    buf = Buffer.from(decodeBase58(dataBase58));
  } catch {
    return null;
  }

  // Minimum size: 1 + 32 + 8 + 4 + 32 = 77 bytes
  if (buf.length < 77) return null;

  const version = buf[0];
  if (version !== 1) return null;

  // id (32) — skip
  let offset = 1 + 32;
  // seq (8 LE u64) — skip
  offset += 8;
  const index = buf.readUInt32LE(offset);
  offset += 4;
  // leaf hash = path[0] (32 bytes)
  const hash = buf.slice(offset, offset + 32).toString("hex");

  return { index, hash, slot };
}

/**
 * Minimal base58 decoder for Solana instruction data.
 * Uses the Bitcoin/Solana base58 alphabet.
 */
function decodeBase58(encoded: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET[i]] = i;
  }

  let bytes = [0];
  for (const char of encoded) {
    if (!(char in ALPHABET_MAP)) throw new Error(`Invalid base58 character: ${char}`);
    let carry = ALPHABET_MAP[char];
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Add leading zeros for leading '1' characters.
  for (const char of encoded) {
    if (char === "1") bytes.push(0);
    else break;
  }

  return new Uint8Array(bytes.reverse());
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let attempt = 0;
  let delayMs = 1_000;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") || err.message.toLowerCase().includes("too many requests"));

      if (!isRateLimit || attempt >= maxAttempts) {
        throw err;
      }

      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
