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

**Option B — manual (two terminals):**

**Terminal 1 — start the app in test mode:**
```bash
bun run dev:test
# equivalent: RAILYN_DEBUG=1 RAILYN_DB=:memory: vite build && electrobun dev --watch
```

Wait ~25s for the app to start, then verify the bridge is up:
```bash
curl http://localhost:9229/
```

**Terminal 2 — run the UI tests:**
```bash
bun run test:ui
# or for just the review overlay suite:
bun run test:ui:review
```

> **Important:** Always use `bun run dev:test` (not `bun run dev`) when running UI tests. `RAILYN_DEBUG=1` is required to open the HTTP debug bridge on `localhost:9229` — without it all UI tests fail immediately with `ConnectionRefused`. `RAILYN_DB=:memory:` uses an isolated in-memory database so tests never touch your real data.

### Debug HTTP bridge

The debug bridge (`localhost:9229`) is only started when `RAILYN_DEBUG=1` is set. It is never open in a normal `bun run dev` session.

```bash
# Start with debug bridge enabled (real DB):
bun run dev:debug
# equivalent: RAILYN_DEBUG=1 vite build && electrobun dev --watch

# Start with debug bridge + isolated in-memory DB (for tests):
bun run dev:test
# equivalent: RAILYN_DEBUG=1 RAILYN_DB=:memory: vite build && electrobun dev --watch

# legacy manual form:
RAILYN_DEBUG=1 bun run dev

# Useful endpoints:
# POST /inspect          — evaluate JS in the WebView and return the result
# GET  /click?selector=  — dispatch click events on a CSS selector
# GET  /screenshot       — take a screenshot
# GET  /reset-decisions  — clear hunk decisions for a task (test helper)
# GET  /setup-test-env   — create a self-contained test task + git worktree
```
