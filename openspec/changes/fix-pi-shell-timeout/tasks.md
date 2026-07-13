## 1. Core async command runner

- [ ] 1.1 Create a small, independently testable async command runner (e.g. `src/bun/engine/pi/tools/shell-runner.ts`) that spawns via `Bun.spawn` with `detached: true`, pipes stdout/stderr, and returns `{ stdout, stderr, exitCode, timedOut, aborted }`. Define it as an interface/type so a fake implementation can be substituted in tests.
- [ ] 1.2 Implement timeout handling in the runner: start a timer for the effective `timeout_ms`; on expiry send SIGTERM to the process group (`-pid`), wait a grace period, then SIGKILL if still running. Make the grace period a constructor/param-level value (not a hardcoded module constant) so tests can use short grace periods.
- [ ] 1.3 Implement `AbortSignal` support in the runner: when the passed signal aborts, immediately run the same SIGTERM→grace→SIGKILL sequence against the process group.
- [ ] 1.4 Ensure the runner cleans up timers/listeners in all exit paths (natural exit, timeout, abort) to avoid leaks.

## 2. Output truncation helper

- [ ] 2.1 Create a pure helper (e.g. `src/bun/engine/pi/tools/truncate-output.ts`) implementing `truncateHeadTail(text, headBytes, tailBytes)` that returns the original text unmodified when under the combined limit, or head+marker+tail when over.
- [ ] 2.2 Decide and document the exact head/tail byte budgets for stdout and stderr (proportional to today's 8KB/2KB split).

## 3. Wire timeout_ms parameter and rewrite run_command

- [ ] 3.1 Add optional `timeout_ms` to `runCommandParams` in `shell.ts` (Type.Integer, default 600_000).
- [ ] 3.2 Implement clamping logic: effective timeout = `Math.min(requested ?? DEFAULT, CEILING)` where `CEILING = 3_600_000`.
- [ ] 3.3 Add an optional runner parameter to `buildShellTool()` (and `buildShellTools()`), defaulting to the real runner from Task 1, so tests can inject a fake runner instead of spawning real processes.
- [ ] 3.4 Replace the `spawnSync` call in `buildShellTool()`'s `execute` with a call to the (possibly injected) runner, passing `harnessCtx.worktreePath`, effective timeout, and `harnessCtx.signal`.
- [ ] 3.5 Replace the current flat truncation logic with calls to `truncateHeadTail` from Task 2 for both stdout and stderr, applied independently per stream.
- [ ] 3.6 Update the `run_command` tool description to mention redirecting verbose output to a file for later inspection with read/grep tools (no platform-specific syntax), and to note the configurable `timeout_ms` behavior/ceiling.

## 4. Propagate execution AbortSignal into HarnessContext

- [ ] 4.1 Add `signal: AbortSignal` to the `HarnessContext` interface in `src/bun/engine/pi/harness/context.ts`.
- [ ] 4.2 Update `PiToolFactory.getOrCreateHarnessContext()` in `tool-factory.ts` to accept and refresh `signal` on every call, the same way `worktreePath` is refreshed today (update signature and both call sites: creation and reuse branches).
- [ ] 4.3 Update `PiToolFactory.buildTools()`'s call to `getOrCreateHarnessContext()` to pass through the execution's signal.
- [ ] 4.4 Update `engine.ts`'s two call sites of `getOrCreateHarnessContext` (`createManagedExecution` and the deprecated wrapper) to pass the execution's `signal`.

## 5. Test infrastructure prerequisite: Stryker Bun.spawn shim

- [ ] 5.1 Extend `src/bun/test/shims/bun-globals.ts`'s `spawn()` shim to pass through `detached` to the underlying `nodeSpawn` call.
- [ ] 5.2 Extend the shim's returned handle to expose `pid` (from the underlying Node child process).
- [ ] 5.3 Extend the shim's returned handle with a `kill(signal?)` method that delegates to the underlying Node child process's `.kill(signal)`.

## 6. Unit tests — fake-runner orchestration (no real process spawning)

- [ ] 6.1 Add tests constructing `buildShellTool()` with a fake runner (canned `{ stdout, stderr, exitCode, timedOut: false, aborted: false }`) and asserting the tool result is derived from it without spawning a real process.
- [ ] 6.2 Add a test asserting the default runner (real `Bun.spawn`-based) is used when `buildShellTool()` is called without an explicit runner argument.
- [ ] 6.3 Add tests for `timeout_ms` clamping: omitted → default 600_000ms passed to the runner; explicit valid value passed through; value above the 3_600_000ms ceiling silently clamped to the ceiling.
- [ ] 6.4 Add tests for `truncateHeadTail()`: under-limit input returned unmodified; over-limit input returns head+marker+tail with the documented byte budgets; stdout and stderr truncated independently of one another.
- [ ] 6.5 Add a test asserting the tool description mentions redirecting output to a file for later inspection, without a platform-specific redirection example.
- [ ] 6.6 Add a test asserting that when the passed `signal` is already aborted (or aborts mid-call), the fake/real runner is invoked with that signal so it can react (verifies wiring, not the runner's internal kill logic).

## 7. Real-process tests — actual spawn/timeout/kill behavior

- [ ] 7.1 Add a test spawning a real command that traps and exits cleanly on SIGTERM, with a short `timeout_ms` and short grace period, asserting the process exits after SIGTERM and SIGKILL is never sent.
- [ ] 7.2 Add a test spawning a real command that ignores SIGTERM, with a short `timeout_ms` and short grace period, asserting SIGKILL is sent once the grace period elapses and the process is confirmed terminated.
- [ ] 7.3 Add a test spawning a real shell command that forks one or more child processes, timing it out, and asserting no process from that command tree remains running afterward (process-group kill, not just the direct child).
- [ ] 7.4 Add a test spawning a real long-running command (e.g. sleeping beyond timeout) with a short `timeout_ms`, asserting the tool result reflects that the command was terminated for exceeding its timeout.

## 8. Cancellation wiring integration tests

- [ ] 8.1 Extend `pi-harness.test.ts`'s `"PiEngine abort & cancel"` describe block with a test asserting that `engine.cancel(executionId)` results in an aborted `HarnessContext.signal` for the mapped conversation, and that other conversations' `HarnessContext.signal` remain unaffected.
- [ ] 8.2 Add a test asserting that a new execution on the same conversation (new `AbortSignal`) refreshes `HarnessContext.signal` to a non-aborted signal, even if the conversation's prior execution was cancelled.

## 9. Full suite validation

- [ ] 9.1 Run the existing backend test suite (`bun test src/bun/test --timeout 20000`) and address any failures caused by the behavior change (e.g. pre-existing `pi-harness.test.ts` assertions, `tool-registry.test.ts` mock `HarnessContext` shape needing a `signal` field).
- [ ] 9.2 Manually verify (outside the automated suite) that a long-running command in a real running instance completes successfully without freezing other concurrent activity, as a final sanity check beyond the automated real-process tests.

