#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/diarization_service"
VENV_DIR="${DIARIZATION_VENV:-$SERVICE_DIR/.venv-diart}"
LEGACY_VENV_DIR="$SERVICE_DIR/.venv"
LOG_DIR="$ROOT_DIR/logs"
HOST="${DIARIZATION_HOST:-0.0.0.0}"
PORT="${DIARIZATION_PORT:-8020}"

mkdir -p "$LOG_DIR"

if [ -x "$VENV_DIR/bin/python" ]; then
  PYTHON="$VENV_DIR/bin/python"
elif [ -x "$LEGACY_VENV_DIR/bin/python" ]; then
  PYTHON="$LEGACY_VENV_DIR/bin/python"
else
  PYTHON="${PYTHON:-python}"
fi

if ! "$PYTHON" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "diarization_service dependencies are missing. Install with: python3 -m venv diarization_service/.venv-diart && diarization_service/.venv-diart/bin/pip install -r diarization_service/requirements.txt" >&2
  exit 1
fi

if [ -f "$SERVICE_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVICE_DIR/.env"
  set +a
fi

cd "$ROOT_DIR"
nohup "$PYTHON" -m uvicorn diarization_service.app.main:app --host "$HOST" --port "$PORT" > "$LOG_DIR/diarization.log" 2>&1 &
echo "$!"
