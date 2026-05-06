## Why

Railyin currently runs only on Unix-like systems (macOS, Linux). The codebase makes several Unix-specific assumptions: hardcoded `/tmp/` paths, `process.env.HOME`, `/bin/sh`-style command execution, `which` for binary discovery, and a Bun-native PTY API (`Bun.spawn` with `terminal:{}`) that does not exist on Windows. These prevent Railyin from starting on Windows even though Bun for Windows is generally available.

This change makes Railyin run natively on Windows alongside macOS and Linux. Bun remains a prerequisite on Windows; no other runtime is added.

## What Changes

- Introduce `src/bun/utils/platform.ts` as the **only** module that branches on `process.platform`. All other modules call helpers (`getHomeDir()`, `getTmpDir()`, `getPathDelimiter()`, `getDefaultShell()`, `getShellArgs()`, `getGitFallbacks()`).
- Migrate `src/bun/launch/pty.ts` from the Bun-native `terminal:{}` API to `node-pty` (already in dependencies). PtySession exposes `write()` / `resize()` / `kill()` so callers (WebSocket handler) become platform-agnostic.
- Replace `/tmp/railyn.port` and `/tmp/railyn-debug.port` writes with `os.tmpdir()`.
- Replace every `process.env.HOME ?? "~"` with `getHomeDir()` (5 call sites).
- Fix `src/bun/git/worktree.ts`: PATH joined with `path.delimiter` instead of `:`; Windows git fallback paths added (`C:\Program Files\Git\...`).
- Fix `src/bun/launch/launcher.ts`, `code-server.ts`, `terminal.ts`: remove hardcoded `which` / `sh -c`; use `Bun.which` and `getDefaultShell()`/`getShellArgs()`.
- Fix `src/bun/handlers/launch.ts`: `SHELL ?? "/bin/bash"` → `getDefaultShell()`.
- Rewrite `package.json` postinstall as `scripts/postinstall.ts` so `chmod` and the `code-server` shell-script postinstall are skipped on Windows (and remain functional on macOS/Linux).
- Soft-disable `code-server` features on Windows. The dependency is Linux/macOS-only; on Windows the relevant launch handlers return a friendly "unavailable on this platform" error rather than crashing.
- Existing tests continue to pass on macOS/Linux. No Windows-specific test investment in this change (per scope).

## Capabilities

### Modified Capabilities

- **`code-server-integration`** — gated to non-Windows platforms; binary discovery moves from `which` to `Bun.which`.
- **`git-worktree`** — `resolveGit()` uses `path.delimiter` and per-platform fallbacks; worktree base path resolution is unchanged but operates correctly on Windows paths via `path.join`.
- **`launch-external-process`** — terminal detection and external app launch use cross-platform shell + `Bun.which`.
- **`terminal-session-pane`** — underlying PTY transport switches to `node-pty` everywhere; WebSocket layer no longer reaches into Bun-specific handles.
- **`shell-env-resolution`** — already skips on Windows; the existing guard remains correct after the migration.
- **`workspace`** (folder dialog handler) — already branches per-platform; the `expandHome` and `/tmp` fallbacks are routed through the new helpers.

### New Capabilities

_None._ This is a portability change — no new product features.

## Non-goals

- Windows CI / GitHub Actions matrix (deferred — tests don't have to pass on Windows for this change).
- Windows e2e (Playwright) coverage.
- Replacing `code-server` with a Windows-native alternative.
- Bundling `git.exe` or any Windows-specific binaries.
- Supporting Cygwin/MSYS/WSL emulation paths (only native Win32 paths).
