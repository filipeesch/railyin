## Why

When Railyin is launched as a macOS `.app` bundle (canary/stable), the OS provides only a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), stripping all user-configured tools (nvm, cargo, Homebrew, pyenv, etc.). This causes `run_command` tool failures, missing LSP server binaries, and broken launch profile commands — the app behaves differently than when started from a terminal.

## What Changes

- New `shell-env` module resolves the full user shell environment at startup by spawning the user's login shell and capturing its environment via JSON serialization (the VS Code approach), then merging the result into `process.env`.
- The resolved environment is automatically inherited by all downstream `spawn`/`spawnSync`/`Bun.spawn` calls — `run_command`, LSP server launch, external tool launch, `rg` probe — with no per-callsite changes.
- A CLI-launch guard (`RAILYN_CLI` env var) skips resolution when the app is already launched from a terminal with a full environment.
- Startup logs the resolved PATH for diagnosability.

## Capabilities

### New Capabilities
- `shell-env-resolution`: Captures and merges the full user login shell environment into the app process on startup, covering macOS and Linux `.app`/daemon launch scenarios.

### Modified Capabilities

## Impact

- **New file**: `src/bun/shell-env.ts` — shell detection, login shell spawn, JSON env capture, merge logic, timeout, caching
- **Modified**: `src/bun/index.ts` — call `resolveShellEnv()` early in startup, before any process spawns
- **Modified**: dev launch scripts / `package.json` — set `RAILYN_CLI=1` so dev builds skip the resolution overhead
- **Dependencies**: none new (uses Node.js `child_process` + `os` already in use)
- **Platforms**: macOS and Linux only; Windows skipped (inherits env correctly from the OS)
