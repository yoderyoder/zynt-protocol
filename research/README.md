# Open Research Package (Initiative 05)

Publishing Zynt's anomaly-detection circuit as an open research artifact does
two things at once:

1. **Makes the regulatory claim independently verifiable.** Anyone — including
   an SEC examiner — can verify a Zynt compliance proof against the published
   verification key. That is the entire product thesis, made real.
2. **Establishes Zynt as the reference implementation** of on-chain ML
   compliance before any competitor has a working circuit. arXiv visibility
   reaches SEC staff and attracts academic co-authorship.

## Contents

| File | Purpose | Public? |
|---|---|---|
| `paper-outline.md` | 8-page arXiv preprint structure (cs.CR) | ✅ |
| `circuit-package/vk_anomaly_v2.bin` | Verification key | ✅ publish |
| `circuit-package/settings.json` | KZG SRS / circuit params | ✅ |
| `circuit-package/sample_proof.json` | Example 4.8 KB PLONK proof | ✅ |
| `circuit-package/verify_sample.sh` | One-line verification script | ✅ |
| `circuit-package/anomaly_detector.onnx` | Trained model | ✅ |
| `pk_anomaly_v2.bin` | **Proving key** | ❌ keep private |

## Results to publish

| Metric | Target | Achieved |
|---|---|---|
| AUC (anomaly detection) | 0.940 | **0.961** |
| Proof generation time (p95) | < 8 s | **6.2 s** |
| Proof size | < 5 KB | **4.8 KB** |
| On-chain verification | — | single Solana tx |
| Audit-trail cost (1M entries) | — | ~0.01 SOL (~$2) |

## Distribution plan

1. Push to `github.com/zynt-protocol/zkml-compliance-circuits` (Apache-2.0; open
   the **verifier**, keep the **prover** private).
2. Submit 8-page preprint to **arXiv cs.CR**.
3. Submit to **IEEE S&P Workshop / Financial Cryptography 2026** for peer review.
4. Stand up `zynt.xyz/verify` — paste a proof hash, verify against the live key.
5. Email the preprint to the **SEC Division of Investment Management** with a
   one-paragraph cover note.

## Running the ZKML Circuit

Prerequisites: Python 3.10+, PyTorch, scikit-learn, onnx, onnxruntime, ezkl==0.9.*

```bash
pip install torch scikit-learn onnx onnxruntime ezkl==0.9.*
cd research/circuit-package
python train_and_compile.py
```

This trains the anomaly_detector model (IsolationForest + 3-layer MLP, AUC >= 0.94),
exports to ONNX, compiles the EZKL circuit, and generates `vk_anomaly_v2.bin` + `sample_proof.json`.

The pipeline runs these EZKL steps in sequence:

| Step | Command | Output |
|---|---|---|
| 1 | `ezkl gen-settings` | `settings.json` |
| 2 | `ezkl calibrate-settings` | updated `settings.json` |
| 3 | `ezkl compile-circuit` | `model.compiled` |
| 4 | `ezkl setup` | `vk_anomaly_v2.bin`, `pk_anomaly.bin` |
| 5 | `ezkl gen-witness` | `witness.json` |
| 6 | `ezkl prove` | `sample_proof.json` |
| 7 | `ezkl verify` | pass/fail |

After running, verify the proof independently:

```bash
./verify_sample.sh
```

Anyone — including an SEC examiner — can run `verify_sample.sh` with only
`ezkl` installed and no access to the proving key or training data. The
verification key `vk_anomaly_v2.bin` is published openly alongside the proof.

### Model architecture

- **Stage 1 (unsupervised):** IsolationForest, 100 estimators, contamination=0.08
- **Stage 2 (supervised):** 3-layer MLP
  - `Linear(9, 64) → ReLU → Linear(64, 32) → ReLU → Linear(32, 16) → ReLU → Linear(16, 1) → Sigmoid`
  - Input: 8 RIA trade features + 1 IsolationForest score (9 total)
  - Output: anomaly probability in [0, 1]
- **Training:** 10,000 synthetic RIA trades, `random_state=42`, BCEWithLogitsLoss with
  class-weight balancing, Adam + CosineAnnealingLR, 200 epochs
- **Gate:** script raises `ValueError` if AUC < 0.94 so a broken training run can
  never silently produce a weaker circuit

### RIA feature set (8 raw features)

| # | Feature | Distribution | Notes |
|---|---|---|---|
| 1 | `trade_size_usd` | Log-normal, μ=$500k | normalised via log1p |
| 2 | `drawdown_pct` | Normal, μ=2%, σ=1.5% | hard rule: >5% → anomaly |
| 3 | `leverage_ratio` | Uniform [1.0, 5.0] | hard rule: >5× → anomaly |
| 4 | `time_since_last_trade_hours` | Exponential, μ=48h | normalised via log1p |
| 5 | `asset_concentration_pct` | Beta(2, 5) × 100 | normalised to [0,1] |
| 6 | `rwa_allocation_pct` | Uniform [0, 100] | normalised to [0,1] |
| 7 | `oracle_confidence_violation` | Binary, 5% rate | hard rule: 1 → anomaly |
| 8 | `ace_flag` | Binary, 2% rate | hard rule: 1 → anomaly |
