#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${MODEL_PATH:-MiniMaxAI/MiniMax-H3}"
MODEL_VARIANT="${MODEL_VARIANT:-fl2va}"
PORT="${PORT:-30010}"
GPU_COUNT="${GPU_COUNT:-4}"
TP_SIZE="${TP_SIZE:-2}"
ULYSSES_DEGREE="${ULYSSES_DEGREE:-2}"

exec sglang serve \
  --model-path "$MODEL_PATH" \
  --num-gpus "$GPU_COUNT" \
  --tp-size "$TP_SIZE" \
  --ulysses-degree "$ULYSSES_DEGREE" \
  --encoder-parallel auto \
  --performance-mode speed \
  --host 0.0.0.0 \
  --port "$PORT" \
  --model-variant "$MODEL_VARIANT"
