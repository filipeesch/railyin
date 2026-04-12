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

UI tests drive the live app through its debug bridge. The app must be running before you execute them.

The bridge port is OS-assigned at startup and written to `/tmp/railyn-debug.port`. `bridge.ts` reads that file automatically.

**Option A — fully automated (recommended):**

```bash
bun run test:ui:run
```

This kills any existing app, starts it in test mode with the debug bridge enabled, runs the suite, then cleans up.

**Option B — manual (two terminals):**

**Terminal 1 — start the app in test mode:**
```bash
bun run dev:test
# equivalent: vite build && electrobun dev --watch -- --debug=0 --memory-db
```

Wait ~25s for the app to start, then verify the bridge is up:
```bash
curl http://localhost:$(cat /tmp/railyn-debug.port)/
```

**Terminal 2 — run the UI tests:**
```bash
bun run test:ui
# or for just the review overlay suite:
bun run test:ui:review
```

> **Important:** Always use `bun run dev:test` (not `bun run dev`) when running UI tests. `--debug=0` is required to open the HTTP debug bridge on a random port — without it all UI tests fail immediately with `ConnectionRefused`. `--memory-db` uses an isolated in-memory database so tests never touch your real data. They reset their own DB state at the start of each suite — no manual cleanup needed.

### Debug HTTP bridge

The debug bridge is only started when the `--debug` flag is passed (never in a normal `bun run dev`). The actual port is written to `/tmp/railyn-debug.port` at startup.

```bash
# Start with debug bridge enabled (real DB, fixed port 9229):
bun run dev:debug
# equivalent: vite build && electrobun dev --watch -- --debug

# Start with debug bridge + isolated in-memory DB (for tests, random port):
bun run dev:test
# equivalent: RAILYN_DEBUG=1 RAILYN_DB=:memory: vite build && electrobun dev --watch

# Useful endpoints:
# POST /inspect          — evaluate JS in the WebView and return the result
# GET  /click?selector=  — dispatch click events on a CSS selector
# GET  /screenshot       — take a screenshot
# GET  /reset-decisions  — clear hunk decisions for a task (test helper)
# GET  /setup-test-env   — create a self-contained test task + git worktree
```

## Copilot Engine

To use the GitHub Copilot engine, set `engine.type: copilot` in your workspace config. On first use, Railyin automatically downloads the Copilot CLI binary (~130MB) and caches it at `~/.railyn/copilot-cli/`.

You must **authenticate** with GitHub Copilot before use (run `copilot auth` in a terminal with the CLI installed, or log in through VS Code's Copilot extension).

## Troubleshooting

### Tools not found in `.app` builds

When running the canary or stable `.app` bundle on macOS or Linux, the AI agent may report "command not found" for tools like `npm`, `cargo`, `rg`, or custom CLIs, even though they work fine in your terminal.

**Cause**: `.app` bundles receive a stripped environment from the OS with only a minimal PATH. Railyin captures your full shell environment at startup to fix this, but there may be issues.

**Solution**:
1. Check the startup logs: `cat ~/.railyn/logs/bun.log | grep shell-env`
2. Verify the resolved PATH contains your tool paths (homebrew, nvm, cargo, etc.)
3. If the shell resolution timed out, check your `.zshrc` or `.bashrc` for slow commands; you can increase the timeout in `workspace.yaml`:
   ```yaml
   shell_env_timeout_ms: 15000  # 15 seconds instead of 10
   ```
4. If a tool is still missing, you can add its path explicitly to `workspace.yaml`:
   ```yaml
   extra_paths:
     - /opt/homebrew/bin
     - ~/.cargo/bin
   ```

### Performance

If app startup feels slow in dev mode, you can skip shell environment resolution:

```bash
bun run dev
# Already has RAILYN_CLI=1 set, so shell resolution is skipped
```

For `.app` builds, the ~100–300ms startup cost is worth the tool visibility improvement.


