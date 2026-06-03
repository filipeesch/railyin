## ADDED Requirements

### Requirement: Pi engine resets the loop detector at the start of each execution and wires beforeToolCall
At the beginning of each `createManagedExecution()` invocation, the Pi engine SHALL call `harnessCtx.loopDetector.reset()`. It SHALL then set `session.agent.beforeToolCall` to a function that calls `harnessCtx.loopDetector.record(toolName, args)` and, if it returns `true`, returns `{ block: true, reason: "Tool loop detected: '${toolName}' (or a group including it) has been called with the same arguments 3 times in the last 15 calls. Try a different approach or summarize your findings." }`. If `record` returns `false`, the hook SHALL return `undefined` to allow the call.

#### Scenario: Loop is blocked during an execution
- **GIVEN** a Pi engine execution is active
- **WHEN** `beforeToolCall` fires for the same `toolName+args` fingerprint for the 3rd time in the window
- **THEN** the call is blocked and the model receives a descriptive error tool result

#### Scenario: Loop detector resets between executions
- **GIVEN** a session that completed an execution where the loop detector was populated
- **WHEN** a new `createManagedExecution()` call starts for the same session
- **THEN** the loop detector is reset and the first `beforeToolCall` call in the new execution does not inherit old state

### Requirement: Child sessions are also guarded
`defaultChildSessionFactory` SHALL create a `new ToolLoopDetector()` for each child session and wire `session.agent.beforeToolCall` with the same block-and-hint logic before calling `session.prompt()`.

#### Scenario: Child session loop is blocked
- **GIVEN** a delegate child session is active
- **WHEN** `beforeToolCall` fires for the same fingerprint for the 3rd time within the child session's execution
- **THEN** the call is blocked and the child model receives a descriptive error tool result
