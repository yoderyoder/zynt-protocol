# Preprint Outline (arXiv cs.CR)

**Title:** ZKMLOps for On-Chain Financial Compliance: Verifiable Anomaly
Detection at 0.961 AUC on Solana with SPL Account Compression Audit Trails

**Authors:** Zynt Protocol CTO; ZK Cryptography Advisor (EZKL core team)

**Target length:** 8 pages + references.

1. **Introduction** — the RIA compliance verification gap; the January 2025
   $63M SEC enforcement action as motivation; the claim that compliance should
   be *provable*, not asserted.
2. **Related Work** — EZKL, Bonsol, Modulus, Giza; the ZKMLOps framework
   (arXiv:2510.26576); prior on-chain audit approaches.
3. **System Architecture** — three Anchor programs (hybrid_vault,
   regulatory_oracle, audit_merkle); the ACE pre-trade / Zynt post-trade split.
4. **Anomaly-Detection Model** — IsolationForest + 3-layer MLP; feature set
   (portfolio drift, leverage ratio, oracle deviation, drawdown, 30-day vol);
   synthetic training methodology.
5. **Proof Generation & Verification** — EZKL → Bonsol pipeline; KZG SRS;
   on-chain PLONK verification; timing and size benchmarks.
6. **Audit Trail** — SPL ConcurrentMerkleTree (depth 20); SEC 17a-3/4 mapping;
   cost analysis (~$2 per 1M entries).
7. **Evaluation** — AUC 0.961; proof time 6.2 s (p95); proof size 4.8 KB;
   312 ms finality; cost tables.
8. **Discussion** — regulatory implications; the post-quantum path
   (Dilithium-3 today, Falcon on SIMD-0416); limitations; future work.

**Reproducibility appendix:** link to the public verifier + `verify_sample.sh`.
