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
```

**2. In a separate terminal, run the UI tests:**

```bash
bun run test:ui
```

> `--debug` opens the debug bridge on `localhost:9229`. Without it the bridge is not available and UI tests cannot run. `--memory-db` uses an isolated in-memory database so tests never touch your real data. They reset their own DB state at the start of each suite — no manual cleanup needed.

### Debug HTTP bridge

The debug bridge (`localhost:9229`) is only started when the `--debug` flag is passed. It is never open in a normal `bun run dev` session.

```bash
# Start with debug bridge enabled:
bun run dev:debug

# Useful endpoints:
# POST /inspect          — evaluate JS in the WebView and return the result
# GET  /click?selector=  — dispatch click events on a CSS selector
# GET  /screenshot       — take a screenshot
# GET  /reset-decisions  — clear hunk decisions for a task (test helper)
# GET  /setup-test-env   — create a self-contained test task + git worktree
```

## Copilot Engine

To use the GitHub Copilot engine you need:

1. **Node.js 22+** in your PATH. The `@github/copilot` CLI uses `node:sqlite` and `node:sea` which require Node 22.

2. **`@github/copilot` installed globally under Node 22:**

   ```sh
   nvm use 22
   npm install -g @github/copilot
   ```

3. **`COPILOT_CLI_PATH` environment variable** pointing to the installed CLI. Add this to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) — it must be evaluated while Node 22 is active:

   ```sh
   export COPILOT_CLI_PATH=$(npm root -g)/@github/copilot/index.js
   ```

4. **Restart your shell** (or `source ~/.zshrc`) then launch the app.

> **Why is this needed?** macOS `.app` bundles don't inherit your shell environment. Railyin reads `COPILOT_CLI_PATH` directly so it can locate the CLI regardless of how the app was launched.

