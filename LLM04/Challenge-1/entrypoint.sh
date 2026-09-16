#!/bin/sh

set -e

MODEL="${1:-${MODEL:-nemotron-3-ultra:cloud}}"
OLLAMA_HOST="${2:-${OLLAMA_HOST:-http://localhost:11434}}"
HOST="${3:-${HOST:-0.0.0.0}}"
PORT="${4:-${PORT:-8000}}"
EMBED_MODEL="${5:-${EMBED_MODEL:-nomic-embed-text}}"

export MODEL OLLAMA_HOST HOST PORT EMBED_MODEL

echo "[LLM04 - Challenge 1] model=${MODEL} embed_model=${EMBED_MODEL} ollama_host=${OLLAMA_HOST} listening on ${HOST}:${PORT}"

exec python app.py
