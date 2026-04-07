---
description: "UI test runner: kill app, start in test mode, wait for bridge, run suite"
---

You are running the Railyn UI test suite. Follow these steps in order, every time, without asking for confirmation.

---

## Step 1 — Kill any existing app instance

```bash
pkill -f "Railyn-dev" || true
pkill -f "electrobun"  || true
sleep 1
```

---

## Step 2 — Start the app in test mode

Use `--memory-db` so tests run against an isolated in-memory database — they never touch `~/.railyn/railyn.db`.

```bash
bun run dev:test > /tmp/railyin-dev.log 2>&1 &
```

Save the PID if you need to kill it later.

---

## Step 3 — Wait for the debug bridge

Poll `http://localhost:9229/` until it responds (up to 45 s). Do NOT proceed until the bridge is ready.

```bash
for i in $(seq 1 45); do
  curl -sf http://localhost:9229/ && break || true
  sleep 1
done
```

---

## Step 4 — Run the UI tests

```bash
bun test src/ui-tests --timeout 120000
```

Report the result clearly: **N pass, M fail**, and list any failures with their error messages.

---

## Step 5 — Clean up

```bash
pkill -f "Railyn-dev" || true
```

---

## Shortcut: use the shell script

All of the above is encapsulated in one command:

```bash
./scripts/run-ui-tests.sh
# or:
bun run test:ui:run
```

---

## If tests fail

1. Read the failure message and the failing test name.
2. Diagnose the root cause in the **implementation** code (in `src/mainview/` or `src/bun/`).  
   Do NOT weaken test assertions to make tests pass.
3. Fix the implementation and re-run from Step 1.

---

## Test environment facts

- **Bridge base**: `http://localhost:9229`
- **Test file**: `src/ui-tests/review-overlay.test.ts`
- **Bridge helpers**: `src/ui-tests/bridge.ts`
- **Debug bridge**: only available when `--debug` flag is passed (port 9229)
- **Test DB**: in-memory SQLite (`--memory-db`), seeded by `/setup-test-env`
- **Worktree fixture**: `/tmp/railyn-test-worktree-<ts>/` — 2 tracked partial-change files (`partial-x.ts`, `partial-y.ts`) + 3 new untracked files (`feature-a.ts`, `feature-b.vue`, `feature-c.md`)
- **Suites**: A–L (23 tests total)
