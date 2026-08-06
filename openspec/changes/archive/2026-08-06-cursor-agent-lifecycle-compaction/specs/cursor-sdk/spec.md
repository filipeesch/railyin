## MODIFIED Requirements

### Requirement: Per-conversation agent lifecycle
The system SHALL use a caller-defined deterministic Cursor `agentId` per conversation, keep the conversation's agent warm in a pool between turns, and resume the same agent across turns so SDK-side chat history is preserved without any Railyin-side persistence.

#### Scenario: Deterministic id derivation

- **WHEN** an execution starts on a conversation
- **THEN** the engine computes `agentId` as a UUIDv5 derived from a fixed Railyin namespace and the name `task:${taskId}` when the conversation is task-scoped, or `conversation:${conversationId}` otherwise
- **AND** passes it directly to the in-process adapter's `run()` call as part of `CursorRunConfig`
- **AND** the derivation is pure: the same `(taskId, conversationId)` always yields the same UUID, and task-scoped ids are independent of `conversationId`

#### Scenario: First execution on a conversation

- **WHEN** the adapter starts a run and no agent exists yet for the `agentId` (first turn)
- **THEN** the adapter calls `Agent.create({ agentId, apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` with the same caller-supplied `agentId`
- **AND** sends the prompt via `agent.send(prompt)`
- **AND** the agent's working directory is the task's worktree path
- **AND** if `agent.send(prompt)` throws `AgentBusyError`, the adapter retries with `{ local: { force: true } }`

#### Scenario: Subsequent execution resumes the warm pooled agent

- **WHEN** the adapter starts a run with the same `agentId` and that agent is still alive in the pool
- **THEN** `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools, settingSources: ["project"] } })` succeeds and returns the same live agent
- **AND** the adapter does NOT call `Agent.create` and does NOT close the agent after the run

#### Scenario: Agent recreated from the local store after eviction or restart

- **WHEN** the adapter starts a run with an `agentId` not present in the pool (evicted after idle timeout, or after process restart) and `Agent.resume(agentId, ...)` throws
- **THEN** the adapter falls back to `Agent.create({ ...baseOptions, agentId })` with the same `agentId`
- **AND** the conversation context is restored from the SDK local store (not lost)
- **AND** the new agent can be resumed on future turns

#### Scenario: Agent is kept open across run terminations, not closed per-turn

- **WHEN** a run ends (normal completion, cancellation, stall, or decision_request abort)
- **THEN** the adapter returns the agent to the pool keyed by `agentId` and does NOT call `agent.close()`
- **AND** the agent is only closed when its idle lease expires or on engine shutdown

#### Scenario: In-turn resume is rejected to force fresh execution

- **WHEN** `CursorEngine.resume(executionId, input)` is called (suspend-loop tools)
- **THEN** it throws an `Error`
- **AND** the calling `HumanTurnExecutor` falls into its fallback restart branch, which starts a new execution with the user input prepended to the prompt

### Requirement: Model listing
The system SHALL list Cursor models available to the configured `api_key`, exposing each model's display metadata and its real context window.

#### Scenario: Models listed with context window

- **WHEN** the engine registry calls `CursorEngine.listModels`
- **THEN** the adapter calls `Cursor.models.list({ apiKey })` directly in-process
- **AND** Railyin returns each as `{ qualifiedId: 'cursor/' + id, displayName, description, contextWindow }`
- **AND** `contextWindow` reflects the model's real context window from the SDK model catalog (e.g. 272k, 300k, 1m), not a hardcoded value

#### Scenario: Context gauge and warning use the real window

- **WHEN** Cursor model selection resolves context usage for a conversation
- **THEN** `resolveContextWindow` uses the `contextWindow` reported by Cursor `listModels()` (falling back only when it is unknown)
- **AND** the UI context gauge and the console context warning reflect the real window rather than a hardcoded 128k

#### Scenario: Missing API key

- **WHEN** neither `engines.yaml` nor `CURSOR_API_KEY` provides an API key
- **THEN** `listModels` returns an empty array and logs a warning

## ADDED Requirements

### Requirement: Per-run token usage reporting
The system SHALL report Cursor per-run token usage so context estimation uses real token counts instead of a character-based heuristic.

#### Scenario: Usage emitted from RunResult

- **WHEN** a Cursor run completes via `run.wait()` and the result carries `usage`
- **THEN** the adapter emits a `usage` EngineEvent with the run's input/output token counts
- **AND** the stream processor persists `executions.input_tokens` / `output_tokens` from that event

#### Scenario: Context estimator uses real usage when available

- **WHEN** a completed Cursor execution has persisted `input_tokens`
- **THEN** `ContextEstimator`/`estimateContextUsage` uses that value as its fast path instead of the character-based heuristic

#### Scenario: Usage absent falls back gracefully

- **WHEN** a Cursor run result carries no `usage`
- **THEN** the adapter does not emit a `usage` event
- **AND** context estimation falls back to the character-based heuristic (with the correct context window) without error
