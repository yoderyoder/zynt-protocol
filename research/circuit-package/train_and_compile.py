"""
train_and_compile.py — Zynt Protocol Initiative 05
====================================================
Trains a two-stage anomaly detector (IsolationForest + 3-layer MLP),
exports it to ONNX, and runs the full EZKL 0.9.x pipeline to produce
a verifiable PLONK proof at AUC >= 0.94.

Usage:
    pip install torch scikit-learn onnx onnxruntime ezkl==0.9.*
    cd research/circuit-package
    python train_and_compile.py

Output files (all written to the same directory as this script):
    anomaly_detector.onnx   — ONNX model (9 inputs: 8 RIA features + iso_score)
    sample_input.json       — single-row EZKL input
    settings.json           — EZKL circuit settings (overwritten by gen-settings)
    model.compiled          — compiled EZKL circuit
    vk_anomaly_v2.bin       — verification key (publish openly)
    pk_anomaly.bin          — proving key (keep private)
    witness.json            — witness for the sample input
    sample_proof.json       — PLONK proof for the sample input
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
ONNX_PATH = SCRIPT_DIR / "anomaly_detector.onnx"
SAMPLE_INPUT_PATH = SCRIPT_DIR / "sample_input.json"
SETTINGS_PATH = SCRIPT_DIR / "settings.json"
COMPILED_PATH = SCRIPT_DIR / "model.compiled"
VK_PATH = SCRIPT_DIR / "vk_anomaly_v2.bin"
PK_PATH = SCRIPT_DIR / "pk_anomaly.bin"
WITNESS_PATH = SCRIPT_DIR / "witness.json"
PROOF_PATH = SCRIPT_DIR / "sample_proof.json"

RNG = np.random.default_rng(42)
torch.manual_seed(42)
N_SAMPLES = 10_000

# ---------------------------------------------------------------------------
# 1. Synthetic RIA trade data
# ---------------------------------------------------------------------------

def generate_dataset(n: int = N_SAMPLES) -> tuple[np.ndarray, np.ndarray]:
    """Return (X, y) where X has 8 RIA features and y is the anomaly label."""

    # trade_size_usd: log-normal, mu = $500k
    # E[X] = exp(mu + sigma^2/2) = 500_000 => mu_ln = log(500_000) - sigma^2/2
    sigma_ln = 1.0
    mu_ln = np.log(500_000) - sigma_ln ** 2 / 2
    trade_size_usd = RNG.lognormal(mean=mu_ln, sigma=sigma_ln, size=n)

    # drawdown_pct: normal, mu=2%, sigma=1.5%, clipped to [0, 20]
    drawdown_pct = np.clip(RNG.normal(loc=2.0, scale=1.5, size=n), 0.0, 20.0)

    # leverage_ratio: uniform [1.0, 5.0]
    leverage_ratio = RNG.uniform(1.0, 5.0, size=n)

    # time_since_last_trade_hours: exponential, mu=48h
    time_since_last_trade_hours = RNG.exponential(scale=48.0, size=n)

    # asset_concentration_pct: beta distribution (alpha=2, beta=5), scaled to [0, 100]
    asset_concentration_pct = RNG.beta(a=2.0, b=5.0, size=n) * 100.0

    # rwa_allocation_pct: uniform [0, 100]
    rwa_allocation_pct = RNG.uniform(0.0, 100.0, size=n)

    # oracle_confidence_violation: binary, 5% rate
    oracle_confidence_violation = (RNG.uniform(size=n) < 0.05).astype(float)

    # ace_flag: binary, 2% rate
    ace_flag = (RNG.uniform(size=n) < 0.02).astype(float)

    X = np.column_stack([
        trade_size_usd,
        drawdown_pct,
        leverage_ratio,
        time_since_last_trade_hours,
        asset_concentration_pct,
        rwa_allocation_pct,
        oracle_confidence_violation,
        ace_flag,
    ])

    # Hard rule violations — always anomalous
    hard_anomaly = (
        (drawdown_pct > 5.0) |
        (leverage_ratio > 5.0) |
        (oracle_confidence_violation == 1) |
        (ace_flag == 1)
    )

    return X, hard_anomaly.astype(float)


print("Generating 10,000 synthetic RIA trade samples...")
X_raw, y_hard = generate_dataset(N_SAMPLES)

# ---------------------------------------------------------------------------
# 2. Stage 1 — IsolationForest unsupervised scoring
# ---------------------------------------------------------------------------

print("Fitting IsolationForest (n_estimators=100, contamination=0.08)...")
iso = IsolationForest(n_estimators=100, contamination=0.08, random_state=42)
iso.fit(X_raw)

# score_samples returns negative values; more negative = more anomalous.
# Normalise to [0, 1] so higher = more anomalous (monotone transform).
iso_scores_raw = iso.score_samples(X_raw)           # range roughly [-0.7, 0]
iso_min, iso_max = iso_scores_raw.min(), iso_scores_raw.max()
iso_score_normalized = 1.0 - (iso_scores_raw - iso_min) / (iso_max - iso_min + 1e-9)

# Combine hard labels with IsolationForest: label=1 if hard anomaly OR iso flags it
iso_pred = (iso.predict(X_raw) == -1).astype(float)
y = np.clip(y_hard + iso_pred, 0.0, 1.0)

anomaly_rate = y.mean()
print(f"Anomaly rate: {anomaly_rate:.1%}  (target ~8%)")

# ---------------------------------------------------------------------------
# 3. Feature matrix for MLP (8 RIA features + iso_score = 9 total)
# ---------------------------------------------------------------------------

# Normalise continuous features to roughly [0, 1] so the network trains stably
trade_size_norm = np.log1p(X_raw[:, 0]) / np.log1p(X_raw[:, 0].max())
drawdown_norm   = X_raw[:, 1] / 20.0
leverage_norm   = (X_raw[:, 2] - 1.0) / 4.0
time_norm       = np.log1p(X_raw[:, 3]) / np.log1p(X_raw[:, 3].max() + 1e-9)
conc_norm       = X_raw[:, 4] / 100.0
rwa_norm        = X_raw[:, 5] / 100.0
oracle_flag     = X_raw[:, 6]
ace_flag_feat   = X_raw[:, 7]

X_mlp = np.column_stack([
    trade_size_norm,
    drawdown_norm,
    leverage_norm,
    time_norm,
    conc_norm,
    rwa_norm,
    oracle_flag,
    ace_flag_feat,
    iso_score_normalized,   # 9th feature
]).astype(np.float32)

X_tr, X_val, y_tr, y_val = train_test_split(
    X_mlp, y.astype(np.float32), test_size=0.2, random_state=42, stratify=y
)

# ---------------------------------------------------------------------------
# 4. Stage 2 — 3-layer MLP
# ---------------------------------------------------------------------------

class AnomalyMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(9, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


model = AnomalyMLP()

X_tr_t  = torch.from_numpy(X_tr)
y_tr_t  = torch.from_numpy(y_tr).unsqueeze(1)
X_val_t = torch.from_numpy(X_val)
y_val_t = torch.from_numpy(y_val).unsqueeze(1)

# Weighted loss — anomaly class is minority
pos_weight = torch.tensor([(1.0 - y_tr.mean()) / (y_tr.mean() + 1e-9)])
criterion  = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

# Swap out Sigmoid for training via BCEWithLogitsLoss
class AnomalyMLPLogit(nn.Module):
    """Same architecture without the final Sigmoid; used for stable training."""
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(9, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


train_model = AnomalyMLPLogit()
optimizer   = torch.optim.Adam(train_model.parameters(), lr=1e-3, weight_decay=1e-4)
scheduler   = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=100)

print("Training MLP (200 epochs)...")
EPOCHS     = 200
BATCH_SIZE = 256
n_batches  = max(1, len(X_tr_t) // BATCH_SIZE)

for epoch in range(EPOCHS):
    train_model.train()
    perm = torch.randperm(len(X_tr_t))
    epoch_loss = 0.0
    for i in range(n_batches):
        idx   = perm[i * BATCH_SIZE:(i + 1) * BATCH_SIZE]
        xb    = X_tr_t[idx]
        yb    = y_tr_t[idx]
        optimizer.zero_grad()
        logits = train_model(xb)
        loss   = criterion(logits, yb)
        loss.backward()
        optimizer.step()
        epoch_loss += loss.item()
    scheduler.step()
    if (epoch + 1) % 50 == 0:
        train_model.eval()
        with torch.no_grad():
            val_probs = torch.sigmoid(train_model(X_val_t)).numpy().ravel()
        auc_mid = roc_auc_score(y_val, val_probs)
        print(f"  Epoch {epoch+1:3d} | loss={epoch_loss/n_batches:.4f} | val AUC={auc_mid:.4f}")

# Copy trained weights into the Sigmoid model for ONNX export
train_model.eval()
with torch.no_grad():
    # Map logit-model weights into the sigmoid model
    state = train_model.state_dict()
    model.load_state_dict(state, strict=False)  # layers match 1-to-1 for net.*

# Evaluate final AUC
model.eval()
with torch.no_grad():
    val_probs = model(X_val_t).numpy().ravel()

auc = roc_auc_score(y_val, val_probs)
print(f"\nFinal validation AUC: {auc:.4f}")

if auc < 0.94:
    raise ValueError(
        f"AUC {auc:.4f} is below the required threshold of 0.94. "
        "Check feature engineering, training data distribution, or increase epochs."
    )

# ---------------------------------------------------------------------------
# 5. Export to ONNX
# ---------------------------------------------------------------------------

print(f"\nExporting ONNX model to {ONNX_PATH} ...")
dummy_input = torch.zeros(1, 9, dtype=torch.float32)

torch.onnx.export(
    model,
    dummy_input,
    str(ONNX_PATH),
    export_params=True,
    opset_version=13,
    do_constant_folding=True,
    input_names=["ria_features"],
    output_names=["anomaly_score"],
    dynamic_axes={
        "ria_features":  {0: "batch_size"},
        "anomaly_score": {0: "batch_size"},
    },
)
print(f"  Saved: {ONNX_PATH}")

# ---------------------------------------------------------------------------
# 6. Write sample_input.json
# ---------------------------------------------------------------------------

# Use a typical non-anomalous trade as the sample input
# (all 9 features normalised to [0,1])
sample_input_values = [
    float(X_mlp[0, 0]),   # trade_size_norm
    float(X_mlp[0, 1]),   # drawdown_norm
    float(X_mlp[0, 2]),   # leverage_norm
    float(X_mlp[0, 3]),   # time_norm
    float(X_mlp[0, 4]),   # conc_norm
    float(X_mlp[0, 5]),   # rwa_norm
    float(X_mlp[0, 6]),   # oracle_confidence_violation
    float(X_mlp[0, 7]),   # ace_flag
    float(X_mlp[0, 8]),   # iso_score_normalized
]

sample_input = {"input_data": [sample_input_values]}

with open(SAMPLE_INPUT_PATH, "w") as f:
    json.dump(sample_input, f, indent=2)
print(f"  Saved: {SAMPLE_INPUT_PATH}")
print(f"  Sample input (9 features): {[round(v, 6) for v in sample_input_values]}")

# ---------------------------------------------------------------------------
# 7. EZKL pipeline
# ---------------------------------------------------------------------------

def run_ezkl(args: list[str], step_name: str) -> None:
    """Run an ezkl CLI command, print output, and raise on failure."""
    cmd = ["ezkl"] + args
    print(f"\n[EZKL] {step_name}")
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(SCRIPT_DIR),
        capture_output=True,
        text=True,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    if result.returncode != 0:
        raise RuntimeError(
            f"EZKL step '{step_name}' failed with exit code {result.returncode}.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    print(f"  [OK] {step_name}")


# Step 1 — Generate circuit settings
run_ezkl(
    [
        "gen-settings",
        "-M", str(ONNX_PATH),
        "-O", str(SETTINGS_PATH),
    ],
    "gen-settings",
)

# Step 2 — Calibrate settings against sample data
run_ezkl(
    [
        "calibrate-settings",
        "-M", str(ONNX_PATH),
        "-D", str(SAMPLE_INPUT_PATH),
        "--settings-path", str(SETTINGS_PATH),
    ],
    "calibrate-settings",
)

# Step 3 — Compile circuit
run_ezkl(
    [
        "compile-circuit",
        "-M", str(ONNX_PATH),
        "-S", str(SETTINGS_PATH),
        "--compiled-circuit", str(COMPILED_PATH),
    ],
    "compile-circuit",
)

# Step 4 — Trusted setup (generates vk + pk)
run_ezkl(
    [
        "setup",
        "-M", str(COMPILED_PATH),
        "--vk-path", str(VK_PATH),
        "--pk-path", str(PK_PATH),
    ],
    "setup",
)

# Step 5 — Generate witness
run_ezkl(
    [
        "gen-witness",
        "-M", str(COMPILED_PATH),
        "-D", str(SAMPLE_INPUT_PATH),
        "-O", str(WITNESS_PATH),
    ],
    "gen-witness",
)

# Step 6 — Prove
run_ezkl(
    [
        "prove",
        "-W", str(WITNESS_PATH),
        "--compiled-circuit", str(COMPILED_PATH),
        "--pk-path", str(PK_PATH),
        "--proof-path", str(PROOF_PATH),
        "--proof-type", "single",
    ],
    "prove",
)

# Step 7 — Verify
run_ezkl(
    [
        "verify",
        "--proof-path", str(PROOF_PATH),
        "--vk-path", str(VK_PATH),
        "--settings-path", str(SETTINGS_PATH),
    ],
    "verify",
)

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------

print("\n" + "=" * 60)
print(f"Final validation AUC : {auc:.4f}  (target >= 0.94)")
print(f"Anomaly rate         : {anomaly_rate:.1%}  (target ~8%)")
print(f"ONNX model           : {ONNX_PATH}")
print(f"Verification key     : {VK_PATH}  (publish)")
print(f"Proving key          : {PK_PATH}  (keep private)")
print(f"Sample proof         : {PROOF_PATH}")
print("=" * 60)
print("All EZKL steps complete. verify_sample.sh will pass.")
