#!/usr/bin/env bash
# run-ui-tests.sh — Full UI test runner for Railyn.
#
# Orchestrates:
#   1. Kill any existing app instance (Railyn-dev + electrobun)
#   2. Build + start the app in test mode (RAILYN_DEBUG=1 RAILYN_DB=:memory: — debug bridge + isolated in-memory DB)
#   3. Wait for the debug bridge on localhost:9229 to be ready
#   4. Run the full UI test suite via bun test
#   5. Kill the app and report the result
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
BRIDGE_URL="http://localhost:9229"
MAX_WAIT_SECS=45

echo "╔══════════════════════════════════════════╗"
echo "║       Railyn UI Test Runner              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 1. Kill any existing instance ───────────────────────────────────────────

echo "→ Stopping existing app instances..."
pkill -f "Railyn-dev" 2>/dev/null || true
pkill -f "electrobun"  2>/dev/null || true
sleep 1

# ─── 2. Build + start in test mode ───────────────────────────────────────────

echo "→ Starting app in test mode (RAILYN_DEBUG=1 RAILYN_DB=:memory:)..."
cd "$PROJECT_DIR"
RAILYN_DEBUG=1 RAILYN_DB=:memory: bun run dev > "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "  App PID: $APP_PID  Log: $LOG_FILE"

# ─── 3. Wait for bridge to be ready ──────────────────────────────────────────

echo -n "→ Waiting for bridge"
READY=0
for i in $(seq 1 "$MAX_WAIT_SECS"); do
  if curl -sf "$BRIDGE_URL/" > /dev/null 2>&1; then
    READY=1
    echo " ✓ (${i}s)"
    break
  fi
  echo -n "."
  sleep 1
done

if [ "$READY" -eq 0 ]; then
  echo ""
  echo "✗ App did not start after ${MAX_WAIT_SECS}s."
  echo "  Check log: $LOG_FILE"
  tail -30 "$LOG_FILE"
  kill "$APP_PID" 2>/dev/null || true
  exit 1
fi

# ─── 4. Run tests ─────────────────────────────────────────────────────────────

echo "→ Running UI tests..."
echo ""
set +e
bun test "$PROJECT_DIR/src/ui-tests" --timeout 120000
TEST_EXIT=$?
set -e

# ─── 5. Cleanup + report ──────────────────────────────────────────────────────

echo ""
echo "→ Stopping app (PID $APP_PID)..."
kill "$APP_PID" 2>/dev/null || true
pkill -f "Railyn-dev" 2>/dev/null || true
sleep 1

echo ""
if [ "$TEST_EXIT" -eq 0 ]; then
  echo "✓ All UI tests passed."
else
  echo "✗ UI tests failed (exit code $TEST_EXIT)."
  echo "  App log: $LOG_FILE"
fi

exit "$TEST_EXIT"
