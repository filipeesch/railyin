## ADDED Requirements

### Requirement: Copilot engine isolates concurrent task executions into separate CLI processes
The system SHALL maintain a pool of Copilot CLI processes, one per active session ID. When a new session is created or resumed for a given session ID, the engine SHALL use a dedicated CLI process for that session ID. Concurrent sessions SHALL NOT share a CLI process.

#### Scenario: Two tasks execute concurrently without interference
- **WHEN** two task executions run at the same time, each with a different session ID
- **THEN** each execution uses its own CLI process and both complete successfully without timeout errors

#### Scenario: Same task resumed reuses existing pool entry
- **WHEN** a task's session is resumed and an active pool entry exists for its session ID
- **THEN** the engine reuses the existing CLI process (no new spawn) and resets the idle timer

#### Scenario: Same task resumed after pool entry evicted creates new CLI
- **WHEN** a task's session is resumed and the pool entry has been evicted (idle timeout)
- **THEN** the engine spawns a new CLI process, reconnects, and resumes from disk session state

### Requirement: Copilot engine recycles idle CLI processes to conserve resources
The system SHALL start a 10-minute idle timer when a pool entry is created or reused. If no session activity occurs for 10 minutes, the CLI process SHALL be stopped and the pool entry removed. The idle timer SHALL be reset each time the pool entry is accessed via a `createSession` or `resumeSession` call.

#### Scenario: Idle CLI process is stopped after 10 minutes
- **WHEN** no task creates or resumes a session for a given session ID for 10 consecutive minutes
- **THEN** the CLI process for that session ID is stopped and the pool entry is removed

#### Scenario: Pool entry survives while task is active
- **WHEN** a task periodically accesses its pool entry within the 10-minute window
- **THEN** the pool entry is never evicted while the task remains active

### Requirement: Copilot engine detects CLI process crashes and fails fast
The system SHALL verify CLI process health on each watchdog timeout by racing `client.ping()` against a 5-second timeout. If `ping()` fails or the 5-second timeout is reached, the execution SHALL fail immediately with a fatal error describing the CLI crash. It SHALL NOT wait for the next 120-second watchdog interval.

#### Scenario: CLI crash detected within 5 seconds of watchdog fire
- **WHEN** the 120s watchdog fires and the CLI process has crashed
- **THEN** `ping()` either rejects or the 5s timeout fires, and the execution yields a fatal error immediately

#### Scenario: Healthy CLI does not trigger immediate failure
- **WHEN** the 120s watchdog fires and `ping()` returns successfully within 5 seconds
- **THEN** no immediate error is emitted; the silence counter is incremented instead

### Requirement: Copilot engine detects permanently stuck sessions and surfaces an error
The system SHALL track a per-execution silence counter that increments each time the watchdog fires with a successful `ping()` result (CLI alive but no session events). When the counter reaches 3, the execution SHALL yield a fatal "session unresponsive" error. The counter SHALL reset to zero whenever a session event is received from the SDK.

#### Scenario: Session unresponsive error emitted after 3 silent watchdog cycles
- **WHEN** the 120s watchdog fires 3 consecutive times and `ping()` succeeds each time with no SDK session events in between
- **THEN** the execution yields `{ type: "error", message: "...", fatal: true }` describing an unresponsive session

#### Scenario: Silence counter resets on session event
- **WHEN** the watchdog has fired once (counter = 1) and then a session event arrives
- **THEN** the silence counter resets to 0 and the timer restarts as a fresh 120s window

#### Scenario: Silence counter resets between executions
- **WHEN** a new `execute()` call starts for the same task
- **THEN** the silence counter begins at 0 for that execution
