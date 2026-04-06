# Railyin

## Development

```bash
bun install
bun run dev
```

## Testing

### Backend tests

Runs unit and integration tests for the Bun backend (no app required):

```bash
bun test
# or
bun run test
```

### UI tests

UI tests drive the live app through its debug bridge (`localhost:9229`). The app must be running before you execute them.

**Option A — fully automated (recommended):**

```bash
bun run test:ui:run
```

This kills any existing app, starts it in test mode with the debug bridge enabled, runs the suite, then cleans up.

**Option B — manual:**

**1. Start the app in debug + test mode:**
```bash
bun run dev:test
# equivalent: RAILYN_DEBUG=1 RAILYN_DB=:memory: bun run dev
```

**2. In a separate terminal, run the UI tests:**

```bash
bun run test:ui
```

> `RAILYN_DEBUG=1` opens the debug bridge on `localhost:9229`. Without it the bridge is not available and UI tests cannot run. `RAILYN_DB=:memory:` uses an isolated in-memory database so tests never touch your real data. They reset their own DB state at the start of each suite — no manual cleanup needed.

### Debug HTTP bridge

The debug bridge (`localhost:9229`) is only started when `RAILYN_DEBUG=1` is set. It is never open in a normal `bun run dev` session.

```bash
# Start with debug bridge enabled:
RAILYN_DEBUG=1 bun run dev

# Useful endpoints:
# POST /inspect          — evaluate JS in the WebView and return the result
# GET  /click?selector=  — dispatch click events on a CSS selector
# GET  /screenshot       — take a screenshot
# GET  /reset-decisions  — clear hunk decisions for a task (test helper)
# GET  /setup-test-env   — create a self-contained test task + git worktree
```
