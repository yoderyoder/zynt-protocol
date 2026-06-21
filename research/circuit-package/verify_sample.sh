#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Verifying Zynt anomaly detector ZKML proof..."
ezkl verify \
  --proof-path sample_proof.json \
  --vk-path vk_anomaly_v2.bin \
  --settings-path settings.json

echo "✓ ZKML proof verified — anomaly_detector AUC 0.961 circuit (Zynt Protocol)"
