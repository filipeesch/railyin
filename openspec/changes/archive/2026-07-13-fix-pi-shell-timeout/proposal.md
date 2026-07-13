## Why

The Pi engine's `run_command` tool (`src/bun/engine/pi/tools/shell.ts`) uses `spawnSync` with a hardcoded 15-second timeout. This causes two compounding failures for real-world workloads: (1) any command that legitimately takes longer than 15s — integration test suites, compilation, `npm install`, long git operations — is killed before it can finish, and (2) `spawnSync` blocks the entire Bun event loop for the full duration of the command, freezing WebSocket pushes, API requests, and every other conversation on the server, not just the one running the command. Long-running tasks are a routine part of Pi-driven development work, so this needs a real fix now rather than a bigger timeout band-aid.

## What Changes

- Replace `spawnSync` in `run_command` with an async, non-blocking process spawn (mirroring the pattern already used in `src/bun/launch/pty.ts` and `fetch_url`'s `AbortController` usage in `tools/web.ts`), so long commands no longer freeze the server.
- Make `timeout_ms` a model-controllable, optional parameter on `run_command` (like `fetch_url`), with a default of 600,000ms (10 minutes) and a hard ceiling of 3,600,000ms (60 minutes). Requests above the ceiling are silently clamped, not rejected.
- Add a `signal: AbortSignal` field to `HarnessContext`, refreshed per-turn the same way `worktreePath` already is, so an in-flight shell command is killed when the user cancels the execution via the UI's existing cancel button.
- On timeout or cancellation, terminate the entire process group (not just the direct `sh` child) using SIGTERM followed by SIGKILL after a short grace period, so test/build sub-processes (e.g. jest workers) don't leak as orphans.
- Change stdout/stderr truncation from a flat head-only cutoff to a head+tail strategy (keep the first ~2KB and last ~6KB of each stream independently), since failures in long test/build output usually surface near the end.
- Update the `run_command` tool description to mention that output can be redirected to a file for later inspection with the read/grep tools, without prescribing shell-specific redirection syntax.

## Capabilities

### New Capabilities
(none — this extends existing tool behavior, no new capability domain)

### Modified Capabilities
- `pi-tool-harness`: `run_command`'s execution model changes from synchronous/blocking with a fixed 15s timeout to asynchronous/non-blocking with a model-configurable timeout (default 10min, ceiling 60min), process-group-aware termination, and head+tail output truncation. `HarnessContext` gains a `signal` field used to propagate execution cancellation into the running shell command.

## Impact

- `src/bun/engine/pi/tools/shell.ts` — core rewrite (async spawn, timeout param, process-group kill, head+tail truncation).
- `src/bun/engine/pi/harness/context.ts` — add `signal: AbortSignal` field to `HarnessContext`.
- `src/bun/engine/pi/tool-factory.ts` — thread `signal` into `getOrCreateHarnessContext` / `buildTools`, refreshed per-turn.
- `src/bun/engine/pi/engine.ts` — pass the execution's `AbortSignal` down to the tool factory call site.
- Existing tests referencing `run_command`'s current sync behavior (e.g. `src/bun/test/pi-harness.test.ts`, `pi-file-tools-tests` spec scenarios) may need updates to reflect async execution — left for the implementation phase per user instruction to not focus on testing during exploration.
- No breaking changes to the tool's public contract from the model's perspective — `command` param behavior is unchanged, `timeout_ms` is additive and optional.
