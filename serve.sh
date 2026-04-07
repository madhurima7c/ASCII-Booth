#!/usr/bin/env bash
# Serve ASCII Booth over HTTP (required for camera). Default port 8080.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "Open: http://127.0.0.1:${PORT}/"
echo "Press Ctrl+C to stop."
exec python3 -m http.server "$PORT"
