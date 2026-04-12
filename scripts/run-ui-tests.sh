#!/usr/bin/env bash
# run-ui-tests.sh — Full UI test runner for Railyn.
#
# Orchestrates:
#   1. Kill any existing app instance (Railyn-dev + electrobun)
#   2. Build + start the app in test mode (debug bridge on OS-assigned random port)
#   3. Wait for the app to announce DEBUG_PORT=N on stdout
#   4. Run the full UI test suite via bun test
#   5. Gracefully shut down the app via /shutdown, fall back to pkill (via EXIT trap)
#
# Usage:
#   ./scripts/run-ui-tests.sh
#   bun run test:ui:run
#
# The in-memory DB means tests create their own workspace/board/project/task rows
# and never touch your real ~/.railyn/railyn.db.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/railyin-dev.log"
BRIDGE_PORT=""
MAX_WAIT_SECS=45

echo "╔══════════════════════════════════════════╗"
echo "║       Railyn UI Test Runner              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 0. Cleanup trap (fires on exit, error, Ctrl+C, or SIGTERM) ──────────────

cleanup() {
  echo ""
  echo "→ Stopping app..."
  if [[ -n "${BRIDGE_PORT}" ]]; then
    curl -sf "http://localhost:${BRIDGE_PORT}/shutdown" > /dev/null 2>&1 || true
    sleep 0.3
  fi
  pkill -f "Railyn-dev" 2>/dev/null || true
  pkill -f "electrobun"  2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ─── 1. Kill any existing instance ───────────────────────────────────────────

echo "→ Stopping existing app instances..."
pkill -f "Railyn-dev" 2>/dev/null || true
pkill -f "electrobun"  2>/dev/null || true
sleep 1

# ─── 2. Build + start in test mode ───────────────────────────────────────────

echo "→ Starting app in test mode (vite build + electrobun dev -- --debug=0 --memory-db)..."
cd "$PROJECT_DIR"
vite build > "$LOG_FILE" 2>&1
electrobun dev --watch -- --debug=0 --memory-db >> "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "  App PID: $APP_PID  Log: $LOG_FILE"

# ─── 3. Wait for DEBUG_PORT= announcement ─────────────────────────────────────

echo -n "→ Waiting for bridge"
for i in $(seq 1 "$MAX_WAIT_SECS"); do
  BRIDGE_PORT=$(grep -m1 '^DEBUG_PORT=' "$LOG_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
  if [[ -n "$BRIDGE_PORT" ]]; then
    echo " ✓ on :$BRIDGE_PORT (${i}s)"
    break
  fi
  echo -n "."
  sleep 1
done

if [[ -z "$BRIDGE_PORT" ]]; then
  echo ""
  echo "✗ App did not announce DEBUG_PORT after ${MAX_WAIT_SECS}s."
  echo "  Check log: $LOG_FILE"
  tail -30 "$LOG_FILE"
  exit 1
fi

# ─── 4. Run tests ─────────────────────────────────────────────────────────────

echo "→ Running UI tests..."
echo ""
set +e
bun test "$PROJECT_DIR/src/ui-tests" --timeout 120000
TEST_EXIT=$?
set -e

# ─── 5. Report (cleanup handled by trap above) ────────────────────────────────

echo ""
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "✓ All UI tests passed."
else
  echo "✗ UI tests failed (exit code $TEST_EXIT)."
  echo "  App log: $LOG_FILE"
fi

exit "$TEST_EXIT"
