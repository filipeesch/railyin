## ADDED Requirements

### Requirement: run_command executes asynchronously without blocking the event loop
The `run_command` tool SHALL spawn its child process asynchronously (e.g. via `Bun.spawn` or `child_process.spawn`) instead of using a synchronous, blocking spawn call. The tool execution SHALL NOT block the Bun event loop for the duration of the command — other concurrent conversations, WebSocket pushes, and API requests SHALL continue to be served while a `run_command` invocation is in flight.

#### Scenario: Long-running command does not freeze other executions
- **WHEN** `run_command` is invoked with a command that takes several minutes to complete
- **THEN** other concurrent Pi executions and API requests continue to be processed without being blocked by the in-flight command

### Requirement: run_command supports a model-configurable timeout
The `run_command` tool SHALL accept an optional `timeout_ms` parameter controlling how long the command may run before being terminated. When omitted, the default timeout SHALL be 600,000ms (10 minutes). When the requested `timeout_ms` exceeds the ceiling of 3,600,000ms (60 minutes), the effective timeout SHALL be silently clamped to the ceiling — no error is returned to the model.

#### Scenario: Default timeout applies when omitted
- **WHEN** `run_command({ command: "..." })` is called without `timeout_ms`
- **THEN** the command is allowed to run for up to 600,000ms before being terminated for exceeding its timeout

#### Scenario: Model-requested timeout is honored up to the ceiling
- **WHEN** `run_command({ command: "...", timeout_ms: 1200000 })` is called (20 minutes)
- **THEN** the command is allowed to run for up to 1,200,000ms before being terminated

#### Scenario: Requested timeout above the ceiling is clamped, not rejected
- **WHEN** `run_command({ command: "...", timeout_ms: 7200000 })` is called (2 hours, above the 60-minute ceiling)
- **THEN** the effective timeout used is 3,600,000ms (60 minutes)
- **AND** no error is returned to the model for exceeding the ceiling

#### Scenario: Real command exceeding a short timeout is terminated and reported
- **WHEN** a real long-running command (e.g. one that sleeps well beyond its timeout) is invoked with a short `timeout_ms`
- **THEN** the command is terminated once `timeout_ms` elapses
- **AND** the tool result indicates the command was terminated for exceeding its timeout

### Requirement: run_command terminates the entire process group on timeout or cancellation
When a `run_command` invocation exceeds its timeout, or when the enclosing execution is cancelled via its `AbortSignal`, the tool SHALL terminate the entire process group spawned for the command (not only the direct shell process), so that child/grandchild processes (e.g. test runner workers) do not remain running as orphans. Termination SHALL first send SIGTERM to the process group, then send SIGKILL if the process group has not exited after a short grace period. The grace period duration SHALL be a configurable value (not a hardcoded, untestable constant) so it can be shortened in automated tests.

#### Scenario: Timeout kills the whole process tree
- **WHEN** a command that spawns child processes (e.g. a test runner with worker processes) exceeds its timeout
- **THEN** the shell process and all of its child processes are terminated
- **AND** no process from that command remains running after the grace period elapses

#### Scenario: Graceful termination before forceful kill
- **WHEN** a command's timeout is reached
- **THEN** SIGTERM is sent to the process group first
- **AND** SIGKILL is sent only if the process group has not exited within the grace period

#### Scenario: Real short-lived process is terminated by SIGTERM within the grace period
- **WHEN** a real (non-fake) command that traps and exits cleanly on SIGTERM is spawned with a short `timeout_ms` and a short grace period
- **THEN** the process exits after receiving SIGTERM
- **AND** SIGKILL is never sent

#### Scenario: Real unresponsive process is force-killed with SIGKILL after grace period
- **WHEN** a real command that ignores SIGTERM is spawned with a short `timeout_ms` and a short grace period
- **THEN** the process is still running immediately after SIGTERM is sent
- **AND** the process is terminated via SIGKILL once the grace period elapses

#### Scenario: Real process group with child processes leaves no orphans
- **WHEN** a real shell command that forks one or more child processes is spawned and then times out
- **THEN** the direct shell process and all of its forked children are no longer running once termination completes

### Requirement: HarnessContext propagates execution cancellation to in-flight shell commands
`HarnessContext` SHALL include a `signal: AbortSignal` field reflecting the current execution's cancellation signal. This field SHALL be refreshed on every turn by `getOrCreateHarnessContext()`, the same way `worktreePath` is refreshed today. The `run_command` tool SHALL observe this signal and terminate its in-flight child process (per the process-group termination requirement) when the signal is aborted.

#### Scenario: Cancelling an execution kills the in-flight shell command
- **WHEN** a `run_command` invocation is in progress
- **AND** the user cancels the execution via the UI's cancel control
- **THEN** the `AbortSignal` on `HarnessContext` is aborted
- **AND** the in-flight shell command's process group is terminated

#### Scenario: HarnessContext signal is refreshed per turn
- **WHEN** `getOrCreateHarnessContext()` is called for an existing conversation with a new execution's `AbortSignal`
- **THEN** the returned `HarnessContext.signal` reflects the new execution's signal, not a stale signal from a previous turn

#### Scenario: engine.cancel() aborts the HarnessContext signal for the mapped conversation
- **WHEN** `engine.cancel(executionId)` is called for an execution mapped to a given conversation
- **THEN** the `HarnessContext.signal` for that conversation reports `aborted === true`
- **AND** the `HarnessContext.signal` for any other conversation remains unaffected

#### Scenario: A fresh execution on the same conversation gets a non-aborted signal
- **WHEN** a conversation's prior execution was cancelled (its `HarnessContext.signal` is aborted)
- **AND** a new execution starts for the same conversation with a new, non-aborted `AbortSignal`
- **THEN** `getOrCreateHarnessContext()` returns a `HarnessContext` whose `signal.aborted` is `false`

### Requirement: run_command's process runner is injectable for testing
`buildShellTool()` SHALL accept an optional command-runner dependency, defaulting to the real asynchronous spawn-based implementation when omitted. This SHALL allow tests to substitute a fake runner that returns canned results synchronously/instantly, without spawning a real process, to verify timeout-clamping, truncation wiring, and signal-abort wiring in isolation. No test SHALL rely on mocking Node/Bun's process-spawning modules (e.g. `vi.mock("child_process")`) to achieve this isolation — dependency injection SHALL be used instead, consistent with existing Pi tool test patterns (e.g. `RunDriver`, `PiCompactionCoordinator` injection in `engine.ts`).

#### Scenario: Fake runner isolates orchestration logic from real process spawning
- **WHEN** `buildShellTool()` is constructed with a fake runner that immediately returns a canned `{ stdout, stderr, exitCode, timedOut: false, aborted: false }` result
- **THEN** invoking `run_command` returns a tool result derived from the fake runner's output
- **AND** no real child process is spawned

#### Scenario: Default runner is used when none is provided
- **WHEN** `buildShellTool()` is constructed without an explicit runner argument
- **THEN** the real asynchronous spawn-based runner is used to execute commands

### Requirement: run_command output truncation preserves both the start and end of output
The `run_command` tool's stdout and stderr truncation SHALL preserve both the beginning and the end of each stream when the combined output exceeds the limit, rather than truncating only the tail. Each stream SHALL independently retain its first ~2KB and its last ~6KB when truncation is necessary, with a marker indicating that content was omitted from the middle.

#### Scenario: Output within limits is returned in full
- **WHEN** a command's stdout is smaller than the combined head+tail limit
- **THEN** the full stdout content is returned unmodified

#### Scenario: Long output preserves head and tail
- **WHEN** a command's stdout exceeds the combined head+tail limit
- **THEN** the returned stdout contains the first ~2KB of the original output
- **AND** the returned stdout contains the last ~6KB of the original output
- **AND** a marker indicates that middle content was omitted

#### Scenario: stdout and stderr are truncated independently
- **WHEN** a command produces stdout under its limit but stderr over its limit (or vice versa)
- **THEN** the stream under its limit is returned in full
- **AND** the stream over its limit is truncated using the head+tail strategy
- **AND** truncation of one stream does not affect whether the other stream is truncated

### Requirement: run_command description documents file-redirection for verbose output
The `run_command` tool description SHALL inform the model that command output can be redirected to a file for later inspection with the file-reading tools when a command's output is expected to be large or verbose, without prescribing platform-specific redirection syntax.

#### Scenario: Tool description mentions redirecting verbose output
- **WHEN** the `run_command` tool definition is inspected
- **THEN** its description mentions that output can be redirected to a file and inspected afterward with the read/grep tools
- **AND** the description does not include a specific shell redirection command example

### Requirement: Test-only Bun.spawn shim supports process-group control
The mutation-testing `Bun.spawn` shim (`src/bun/test/shims/bun-globals.ts`, used only by the Vitest/Stryker test path) SHALL support passing through `detached`, exposing the spawned process's `pid`, and exposing a `kill(signal?)` method that delegates to the underlying Node child process. This keeps the shim capable of running the new async command runner under Stryker mutation testing, should `shell.ts` later be added to `stryker.backend.json`'s `mutate` list.

#### Scenario: Shim spawn supports detached and pid
- **WHEN** the shimmed `Bun.spawn()` is called with `{ detached: true }` under Vitest
- **THEN** the returned handle exposes a `pid` matching the underlying spawned process
- **AND** the underlying Node `spawn()` call receives `detached: true`

#### Scenario: Shim spawn exposes a working kill method
- **WHEN** the shimmed `Bun.spawn()`'s returned handle's `kill(signal)` is called
- **THEN** the underlying Node child process receives the given signal (or SIGTERM by default)
