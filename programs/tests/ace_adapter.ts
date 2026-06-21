/**
 * ace_adapter integration tests — Initiative 01
 *
 * Covers all 6 ACE compliance gates:
 *   1. KYC — rejects wallet where kyc_passed = false
 *   2. AML score — rejects wallet below min_aml_score threshold
 *   3. Sanctions — rejects wallet with sanctions_ok = false
 *   4. Accreditation — rejects non-accredited wallet when policy.require_accreditation = true
 *   5. Jurisdiction allowlist — rejects wallet whose jurisdiction is not on the allowlist
 *   6. Freshness (staleness) — rejects attestation older than policy.max_age_secs
 *
 * Plus a golden-path test that shows all 6 gates passing simultaneously.
 *
 * Run with: anchor test --skip-deploy
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";

// Program IDs from Anchor.toml [programs.localnet]
const ACE_ADAPTER_ID = new PublicKey(
  "5uSmcAfpVkXMGRCsHsBaRmRkd2CWXtQHaNhXSwCjcKTJ"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ISO 3166-1 alpha-2 jurisdiction as [u8; 2] */
function jurisdiction(code: string): number[] {
  const buf = Buffer.from(code, "ascii");
  return [buf[0], buf[1]];
}

/** Derive [b"ace", wallet] PDA for the given wallet key */
function aceAttestationPda(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ace"), wallet.toBuffer()],
    ACE_ADAPTER_ID
  );
}

/** Default passing AttestationArgs */
function passingArgs(wallet: PublicKey) {
  return {
    wallet,
    kycPassed: true,
    amlScore: 80,
    sanctionsOk: true,
    accredited: true,
    jurisdiction: jurisdiction("US"),
  };
}

/**
 * Default passing TradePolicy.
 * Mirrors the Rust `TradePolicy::default()`:
 *   min_aml_score = 70, require_accreditation = false,
 *   allowed_jurisdictions = [], max_age_secs = 86400
 */
function defaultPolicy() {
  return {
    minAmlScore: 70,
    requireAccreditation: false,
    allowedJurisdictions: [] as number[][],
    maxAgeSecs: new BN(86_400),
  };
}

/**
 * Record an attestation on-chain.
 */
async function recordAttestation(
  program: Program,
  attestor: Keypair,
  args: {
    wallet: PublicKey;
    kycPassed: boolean;
    amlScore: number;
    sanctionsOk: boolean;
    accredited: boolean;
    jurisdiction: number[];
  }
): Promise<PublicKey> {
  const [attestationPda] = aceAttestationPda(args.wallet);

  await program.methods
    .recordAttestation(args)
    .accounts({
      attestation: attestationPda,
      aceAttestor: attestor.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([attestor])
    .rpc();

  return attestationPda;
}

/**
 * Call validate_before_trade and return success/error string.
 * Returns null on success, error message string on failure.
 */
async function tryValidate(
  program: Program,
  wallet: PublicKey,
  policy: ReturnType<typeof defaultPolicy>
): Promise<string | null> {
  const [attestationPda] = aceAttestationPda(wallet);
  try {
    await program.methods
      .validateBeforeTrade(policy)
      .accounts({
        attestation: attestationPda,
      })
      .rpc();
    return null; // success
  } catch (e: any) {
    return e.toString();
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ace_adapter — 6 compliance gates", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const aceAdapter = anchor.workspace.AceAdapter as Program;

  // Each test uses a fresh wallet keypair so PDAs are independent
  let attestor: Keypair;

  before(async () => {
    // Fund payer if on localnet (test validator starts with funded payer)
    attestor = payer; // In tests, the attestor is the payer (simulates CRE oracle)
  });

  // ── GATE 0: Golden path — all 6 gates pass ──────────────────────────────

  it("golden path: passes all 6 gates with a valid attestation", async () => {
    const wallet = Keypair.generate();

    // Create and record a fully-passing attestation
    await recordAttestation(aceAdapter, attestor, passingArgs(wallet.publicKey));

    const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

    assert.isNull(err, `Expected success but got: ${err}`);

    // Verify the on-chain attestation data
    const [attPda] = aceAttestationPda(wallet.publicKey);
    const att = await aceAdapter.account.aceAttestation.fetch(attPda);
    assert.ok(att.wallet.equals(wallet.publicKey), "wallet pubkey stored correctly");
    assert.isTrue(att.kycPassed, "kycPassed must be true");
    assert.equal(att.amlScore, 80, "amlScore stored correctly");
    assert.isTrue(att.sanctionsOk, "sanctionsOk must be true");
    assert.isTrue(att.accredited, "accredited must be true");
    assert.deepEqual(
      Array.from(att.jurisdiction),
      jurisdiction("US"),
      "jurisdiction stored correctly"
    );
  });

  // ── GATE 1: KYC ─────────────────────────────────────────────────────────

  it("gate 1 — KYC: rejects wallet with kyc_passed = false", async () => {
    const wallet = Keypair.generate();

    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      kycPassed: false, // fail KYC
    });

    const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

    assert.isNotNull(err, "Expected KYC rejection");
    assert.include(
      err!,
      "KycNotPassed",
      `Expected KycNotPassed error, got: ${err}`
    );
  });

  // ── GATE 2: AML score ────────────────────────────────────────────────────

  it("gate 2 — AML score: rejects wallet with aml_score below threshold", async () => {
    const wallet = Keypair.generate();

    // Record attestation with score 50, policy requires >= 70
    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      amlScore: 50,
    });

    const policy = { ...defaultPolicy(), minAmlScore: 70 };
    const err = await tryValidate(aceAdapter, wallet.publicKey, policy);

    assert.isNotNull(err, "Expected AML score rejection");
    assert.include(
      err!,
      "AmlScoreBelowThreshold",
      `Expected AmlScoreBelowThreshold error, got: ${err}`
    );
  });

  it("gate 2 — AML score: passes when score exactly equals min_aml_score", async () => {
    const wallet = Keypair.generate();

    // Record attestation with score exactly at the threshold
    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      amlScore: 70,
    });

    const policy = { ...defaultPolicy(), minAmlScore: 70 };
    const err = await tryValidate(aceAdapter, wallet.publicKey, policy);

    assert.isNull(err, `Expected pass at boundary score=70, got: ${err}`);
  });

  // ── GATE 3: Sanctions ────────────────────────────────────────────────────

  it("gate 3 — Sanctions: rejects wallet with sanctions_ok = false", async () => {
    const wallet = Keypair.generate();

    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      sanctionsOk: false, // OFAC flag
    });

    const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

    assert.isNotNull(err, "Expected sanctions rejection");
    assert.include(
      err!,
      "SanctionsFlag",
      `Expected SanctionsFlag error, got: ${err}`
    );
  });

  // ── GATE 4: Accreditation (conditional — only for RWA assets) ────────────

  it(
    "gate 4 — Accreditation: rejects non-accredited wallet " +
      "when policy.require_accreditation = true",
    async () => {
      const wallet = Keypair.generate();

      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        accredited: false,
      });

      const policy = { ...defaultPolicy(), requireAccreditation: true };
      const err = await tryValidate(aceAdapter, wallet.publicKey, policy);

      assert.isNotNull(err, "Expected accreditation rejection");
      assert.include(
        err!,
        "NotAccredited",
        `Expected NotAccredited error, got: ${err}`
      );
    }
  );

  it(
    "gate 4 — Accreditation: non-accredited wallet PASSES " +
      "when policy.require_accreditation = false (non-RWA asset)",
    async () => {
      const wallet = Keypair.generate();

      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        accredited: false,
      });

      // Default policy: require_accreditation = false
      const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

      assert.isNull(
        err,
        `Expected pass for non-RWA with accredited=false, got: ${err}`
      );
    }
  );

  // ── GATE 5: Jurisdiction allowlist ───────────────────────────────────────

  it(
    "gate 5 — Jurisdiction: rejects wallet whose jurisdiction " +
      "is not on the allowlist",
    async () => {
      const wallet = Keypair.generate();

      // Wallet is in "CN" but policy only allows "US" and "GB"
      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        jurisdiction: jurisdiction("CN"),
      });

      const policy = {
        ...defaultPolicy(),
        allowedJurisdictions: [jurisdiction("US"), jurisdiction("GB")],
      };
      const err = await tryValidate(aceAdapter, wallet.publicKey, policy);

      assert.isNotNull(err, "Expected jurisdiction rejection");
      assert.include(
        err!,
        "JurisdictionBlocked",
        `Expected JurisdictionBlocked error, got: ${err}`
      );
    }
  );

  it(
    "gate 5 — Jurisdiction: passes when wallet jurisdiction IS on the allowlist",
    async () => {
      const wallet = Keypair.generate();

      // Wallet is in "US", policy allows "US" and "GB"
      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        jurisdiction: jurisdiction("US"),
      });

      const policy = {
        ...defaultPolicy(),
        allowedJurisdictions: [jurisdiction("US"), jurisdiction("GB")],
      };
      const err = await tryValidate(aceAdapter, wallet.publicKey, policy);

      assert.isNull(err, `Expected pass for US in US/GB allowlist, got: ${err}`);
    }
  );

  it(
    "gate 5 — Jurisdiction: empty allowlist allows all jurisdictions",
    async () => {
      const wallet = Keypair.generate();

      // Wallet is in "BR" (Brazil) — default policy has empty allowlist
      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        jurisdiction: jurisdiction("BR"),
      });

      const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

      assert.isNull(
        err,
        `Expected pass with empty allowlist (allow-all), got: ${err}`
      );
    }
  );

  // ── GATE 6: Freshness / staleness ────────────────────────────────────────

  it(
    "gate 6 — Freshness: rejects an attestation older than max_age_secs",
    async () => {
      const wallet = Keypair.generate();

      // Record a fresh attestation
      await recordAttestation(aceAdapter, attestor, passingArgs(wallet.publicKey));

      // Policy with an extremely short max_age_secs (0 seconds = always stale
      // once any time has passed, but to be deterministic use 1 second while
      // the current block timestamp will have the attestation at verified_at == now,
      // making age = 0 which is < 1, so we need a policy of 0 to force the fail).
      const stalePolicy = {
        ...defaultPolicy(),
        maxAgeSecs: new BN(0), // 0 seconds → always stale
      };
      const err = await tryValidate(aceAdapter, wallet.publicKey, stalePolicy);

      assert.isNotNull(err, "Expected staleness rejection with max_age_secs=0");
      assert.include(
        err!,
        "AttestationStale",
        `Expected AttestationStale error, got: ${err}`
      );
    }
  );

  it(
    "gate 6 — Freshness: passes when attestation is within max_age_secs window",
    async () => {
      const wallet = Keypair.generate();

      // Record a fresh attestation — verified_at will be current block time
      await recordAttestation(aceAdapter, attestor, passingArgs(wallet.publicKey));

      // 24-hour window — a just-recorded attestation has age ~0
      const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

      assert.isNull(
        err,
        `Expected pass for freshly-recorded attestation, got: ${err}`
      );
    }
  );

  // ── Composite: multiple simultaneous failures are all reported on KYC first
  // (because KYC is checked before AML and sanctions in the Rust code) ──────

  it(
    "composite: when KYC fails and AML also fails, " +
      "KycNotPassed is the error (checked first)",
    async () => {
      const wallet = Keypair.generate();

      await recordAttestation(aceAdapter, attestor, {
        ...passingArgs(wallet.publicKey),
        kycPassed: false,
        amlScore: 0,
        sanctionsOk: false,
      });

      const err = await tryValidate(aceAdapter, wallet.publicKey, defaultPolicy());

      assert.isNotNull(err);
      assert.include(
        err!,
        "KycNotPassed",
        `Expected KycNotPassed to be reported first, got: ${err}`
      );
    }
  );

  // ── record_attestation: emits AttestationRecorded event ─────────────────

  it("record_attestation: updates on-chain state correctly when re-attested", async () => {
    const wallet = Keypair.generate();
    const [attPda] = aceAttestationPda(wallet.publicKey);

    // Initial attestation — failing AML
    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      amlScore: 40,
    });

    let att = await aceAdapter.account.aceAttestation.fetch(attPda);
    assert.equal(att.amlScore, 40, "initial AML score stored");

    // Re-attest with a passing AML score (simulate re-screening)
    await recordAttestation(aceAdapter, attestor, {
      ...passingArgs(wallet.publicKey),
      amlScore: 85,
    });

    att = await aceAdapter.account.aceAttestation.fetch(attPda);
    assert.equal(att.amlScore, 85, "re-attested AML score updated");
    assert.isTrue(att.kycPassed, "KYC still passing after re-attest");
    assert.isTrue(att.sanctionsOk, "sanctions still clear after re-attest");
  });
});
