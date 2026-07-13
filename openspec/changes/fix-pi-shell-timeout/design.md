## Context

`src/bun/engine/pi/tools/shell.ts` implements the Pi engine's only shell-execution tool, `run_command`. Today it calls Node's `spawnSync("sh", ["-c", command], { timeout: 15_000, ... })`. `spawnSync` is a **blocking** call — the entire Bun process (single-threaded event loop) is frozen for the full duration of the child process, not just the current conversation. Combined with a fixed 15-second timeout, this makes any realistic integration-test, build, or install command fail, and makes the freeze itself a server-wide problem whenever a command does run close to the limit.

The recent Pi engine refactor (`refactor-pi-engine`, merged from `main`) split the monolithic engine into `execution-controller.ts`, `run-driver.ts`, `tool-factory.ts`, `session-manager.ts`, etc. `PiToolFactory.getOrCreateHarnessContext()` already has a precedent for refreshing per-turn state (`worktreePath` is updated on every call even when reusing an existing `HarnessContext`), which this design reuses for propagating the execution's `AbortSignal`.

Two existing patterns in the codebase already solve the "async, cancellable subprocess" problem and should be reused rather than reinvented:
- `src/bun/launch/pty.ts` uses `Bun.spawn()` with a `terminal` block for interactive shells — proves async spawn is idiomatic here.
- `src/bun/engine/pi/tools/web.ts`'s `fetch_url` tool uses `AbortController` + `setTimeout` for a model-configurable per-call timeout — the pattern this design mirrors for `run_command`.

## Goals / Non-Goals

**Goals:**
- Make `run_command` non-blocking so long commands don't freeze the whole server.
- Let commands run realistically long (default 10 min, up to 60 min) while keeping a hard ceiling.
- Ensure cancelling an execution from the UI actually kills any in-flight shell command and its children.
- Avoid orphaned child/grandchild processes (e.g. test runner workers) after timeout or cancellation.
- Preserve the ability to redirect verbose output to a file for later inspection, and improve in-band truncation to keep both ends of long output.

**Non-Goals:**
- Adding a full interactive PTY-backed shell tool for the model (that's a different, larger feature — this is about the existing one-shot `run_command` tool).
- Changing tool call approval/security semantics (`shell-command-approval` capability is untouched).
- Playwright/UI test coverage — the frontend's tool-output truncation display is generic and tool-agnostic; this change adds no shell-specific UI behavior to validate, and the e2e/ui backend is fully mocked so it cannot exercise real timeout/kill behavior anyway.
- Windows process-group semantics — this codebase's shell tooling already targets macOS/Linux primarily (see comment in `pty.ts`); Windows can fall back to best-effort single-process kill.

## Decisions

### 1. Async spawn via `Bun.spawn` (with `node:child_process.spawn` fallback if needed)
Replace `spawnSync` with `Bun.spawn(["sh", "-c", command], { cwd, env, stdout: "pipe", stderr: "pipe" })`, reading streams asynchronously and awaiting `proc.exited`. This is a straightforward drop-in given Bun is the runtime already used everywhere else (`pty.ts`). Alternative considered: `node:child_process.spawn` — works identically here since Bun implements the Node API, but `Bun.spawn` was chosen for consistency with `pty.ts`'s existing precedent and slightly better native performance.

### 2. Process-group kill via `detached: true` + negative-PID signal
Spawn with `detached: true` so the child becomes its own process-group leader, then terminate via `process.kill(-pid, "SIGTERM")` / `process.kill(-pid, "SIGKILL")` (negative PID targets the whole group on POSIX). This ensures `sh -c "npm test"` and any workers it forks are all terminated together. Alternative considered: killing only the direct `sh` PID — rejected because it leaves orphaned grandchildren (e.g. jest/vitest worker processes) running and holding resources/file locks, which directly undermines the "long test suite" use case this task targets.

### 3. Timeout: model-controllable parameter, default 10 min / ceiling 60 min, silently clamped
Add `timeout_ms` as an optional `Type.Integer` tool parameter (mirroring `fetch_url`'s `timeout_ms`). Default 600,000ms, ceiling 3,600,000ms. Values above the ceiling are clamped rather than rejected — avoids burning a model turn on a retry loop for an easily-corrected input, consistent with how output truncation already silently caps rather than errors.

### 4. Termination sequence: SIGTERM → grace period → SIGKILL
On timeout expiry or `AbortSignal` abort, send SIGTERM to the process group, wait a short grace period (2–5s), then send SIGKILL if still alive. This mirrors how process managers like systemd/docker handle shutdown and gives well-behaved test/build tools a chance to flush output and clean up temp files/lockfiles before the harder kill.

### 5. `HarnessContext.signal: AbortSignal`, refreshed per-turn
Add `signal` alongside `worktreePath` in `HarnessContext`, both set in `getOrCreateHarnessContext(conversationId, worktreePath, signal)`. The execution's `AbortSignal` (already flowing through `ExecutionParams.signal` → `engine.ts` → `execution-controller.ts`) is passed one level further into the tool factory call site in `engine.ts`. This keeps `HarnessContext` a plain per-conversation state bag (per its existing single-responsibility role) rather than introducing a new global registry or singleton — consistent with SOLID/DI principles already used in this file (constructor-injected `config`, `onTaskUpdated`, `onCancel`).

### 6. Output truncation: head (2KB) + tail (6KB), independent per stream
Replace the current head-only truncation with a head+tail strategy per stream (stdout gets its own 2KB head / 6KB tail budget, stderr the same, sized proportionally to their existing 8KB/2KB totals — exact split TBD at implementation time but stdout gets the larger overall budget matching today's ratio). A middle-omission marker is inserted between the two kept sections. This is implemented as a small pure `truncateHeadTail(text, headBytes, tailBytes)` helper — independently testable, no dependency on the process-spawning logic.

### 7. Composition over one big rewritten function
Rather than growing `shell.ts` into one large function that handles spawning, timeout, kill-escalation, and truncation inline, the implementation should factor out:
- a small async runner responsible only for spawn + timeout + process-group kill + AbortSignal wiring (returns `{ stdout, stderr, exitCode, timedOut, aborted }`)
- a pure `truncateHeadTail` helper for output shaping
- `buildShellTool()` stays the thin orchestrator that wires tool schema ↔ runner ↔ truncation ↔ result formatting, as today

This avoids a shell.ts god-function and keeps each piece independently reasoned about/testable later, matching the DI/loose-coupling instruction for this task.

### 8. Test strategy: dependency injection over module mocking
The runner from Decision 7 is exposed as an optional parameter on `buildShellTool()`/`buildShellTools()`, defaulting to the real implementation. Tests substitute a fake runner (a plain object/function returning canned results) rather than using `vi.mock("child_process")` or similar module-level mocking. This mirrors the existing convention in this codebase (`RunDriver`/`PiCompactionCoordinator` injection in `engine.ts`, `FAKE_TOOL_DEFS` in `pi-common-tools-bridge.test.ts`) and keeps orchestration logic (timeout clamping, truncation wiring, signal wiring) testable in milliseconds without OS process overhead. Alternative considered: `vi.mock()`-based module mocking — rejected because it's explicitly against this codebase's established test style and is more brittle across module boundaries (ESM mocking pitfalls, harder to reason about call-order assertions).

Real process spawning is still exercised, but only in a smaller, separate set of tests targeting the runner's actual OS-level behavior (SIGTERM/SIGKILL timing, process-group kill) — since `bun test` runs on the real Bun runtime, these are fast and require no sandboxing. This two-tier approach (fake-runner unit tests + real-process behavior tests) gives full coverage of both the tool's orchestration logic and its process-management correctness, without conflating the two concerns in either direction.

The one exception is the Stryker/Vitest mutation-testing path, which runs through a Node-based `Bun.spawn` shim (`bun-globals.ts`) rather than the real Bun runtime. That shim needs a small extension (pass through `detached`, expose `pid`/`kill()`) so the new runner remains mutation-testable if `shell.ts` is added to `stryker.backend.json`'s `mutate` list in the future — this is test-infrastructure housekeeping, not part of the shell.ts fix itself.

## Risks / Trade-offs

- **[Risk]** Longer default/ceiling timeouts mean a stuck or hanging command occupies a turn for up to 60 minutes before the model gets any feedback. → **Mitigation**: the model can pass a smaller `timeout_ms` itself for commands it expects to be quick; the ceiling is a safety net, not the expected common case.
- **[Risk]** `detached: true` + process-group kill is POSIX-specific (negative PID semantics). → **Mitigation**: scope this design to macOS/Linux (already the stated primary target per `pty.ts`); Windows can fall back to single-process `proc.kill()` without process-group semantics, to be handled explicitly in implementation rather than silently broken.
- **[Risk]** Head+tail truncation changes the exact byte budget models have seen before, which existing tests/fixtures may assert against. → **Mitigation**: `tool-registry.test.ts`'s mock `HarnessContext` objects will need a `signal` field added, and any assertions on the old flat-truncation shape updated as part of this change's own test tasks (see tasks.md §6, §9).
- **[Trade-off]** Silently clamping `timeout_ms` above the ceiling instead of erroring means a model requesting an absurd value gets no explicit feedback that its request was reduced. Accepted per user decision — avoids an extra round-trip for what's expected to be a rare edge case.
- **[Risk]** Real-process tests (SIGTERM/SIGKILL timing) are inherently timing-sensitive and could be flaky under CI load. → **Mitigation**: keep grace periods and timeouts in these tests as short as reliably possible (tens of milliseconds) since the runner's grace period is configurable per Decision 7/8, minimizing wall-clock exposure to scheduling jitter.

## Migration Plan

- No data migration or persisted state involved — this is a pure behavior change inside one execution engine's tool implementation.
- No feature flag needed: the change is backward compatible from the model's perspective (`command` param unchanged, `timeout_ms` additive/optional), and the async spawn is a drop-in replacement for the sync one at the same call site.
- Rollback is a straightforward revert of the `shell.ts` (and small `context.ts`/`tool-factory.ts`/`engine.ts` signal-wiring) changes if issues surface.

## Open Questions

- Exact head/tail byte split for stdout vs stderr (proportional to today's 8KB/2KB ratio, or a flat 2KB/6KB per stream regardless of stream type) — left to implementation, does not affect the overall approach.
- Exact grace period between SIGTERM and SIGKILL (2s vs 5s) — left to implementation as a tunable constant.
