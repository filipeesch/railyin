## Purpose

Defines the shared task-management tool layer: common tool definitions, `executeCommonTool` dispatch, typed results, and the `CommonToolContext` injected into every engine's tool builders.

## Requirements

### Requirement: executeCommonTool normalizes args at the choke-point
The `executeCommonTool` function SHALL call `normalizeToolArguments(def.parameters, args)` at the top of its dispatch, before `validateToolArgs`, so string-encoded array/object arguments from models are reconciled to native values identically across all engines. The normalization SHALL be idempotent so engines that also normalize via `prepareArguments` (Pi) remain correct.

#### Scenario: String-encoded questions array reconciled before validation
- **WHEN** `executeCommonTool` receives a `decision_request` call whose args were serialized as a JSON string by the model
- **THEN** the args are parsed to native objects before AJV validation
- **AND** validation passes for otherwise-valid questions

#### Scenario: All engines share the same normalization path
- **WHEN** any engine (Pi, Cursor, Claude, Copilot, OpenCode) dispatches a common tool through `executeCommonTool`
- **THEN** the same normalization runs for every engine before validation

### Requirement: ToolExecutionResult includes a page variant
The `ToolExecutionResult` discriminated union SHALL include `{ type: "page"; text: string; payload: string }` in addition to `{ type: "result"; text: string; ... }` and `{ type: "suspend"; text: string; payload: string }`. The `page` variant SHALL signal that a question was appended and the agent loop must continue; the `suspend` variant SHALL remain reserved for `ask_user`/`shell_approval`-style paths that halt the loop.

#### Scenario: decision_request returns page variant
- **WHEN** `executeCommonTool("decision_request", { question: {...} }, ctx)` succeeds
- **THEN** the result is `{ type: "page", text, payload }` and the engine continues the loop

#### Scenario: suspend variant retained for ask_user paths
- **WHEN** a suspend-loop tool (e.g. ask_user-style path) returns
- **THEN** the result is `{ type: "suspend", text, payload }` and the engine aborts the loop

### Requirement: Shared pure turn-end flush helper
The system SHALL provide a pure, IO-free helper `buildDecisionRequestTerminalEvent(buffer: DecisionQuestionBuffer): EngineEvent | null` that returns the terminal `{ type: "decision_request", payload }` event when the buffer is non-empty and `null` when empty. Every engine SHALL call it immediately before emitting `done` and SHALL yield the returned terminal event instead of `done` when non-null. (Decision D10.)

#### Scenario: Non-empty buffer yields terminal decision_request
- **WHEN** `buildDecisionRequestTerminalEvent` is called with a buffer containing two questions
- **THEN** it returns a `decision_request` event whose payload contains exactly those two questions
- **AND** the buffer is drained/cleared as part of the engine's turn-end flush

#### Scenario: Empty buffer yields null
- **WHEN** `buildDecisionRequestTerminalEvent` is called with an empty buffer
- **THEN** it returns `null` and the engine proceeds to emit `done` normally

### Requirement: CommonToolContext carries a per-execution decision buffer
The `CommonToolContext.runtime` SHALL include a `decisionBuffer` field of type `DecisionQuestionBuffer`. Each engine SHALL create a fresh buffer per execution and assign it to the context before the run. The buffer SHALL expose `append(entry)`, `all`, `count`, and `clear()`.

#### Scenario: Context populated with fresh buffer per execution
- **WHEN** an engine builds a `CommonToolContext` for a new execution
- **THEN** `runtime.decisionBuffer` is a fresh empty `DecisionQuestionBuffer`

#### Scenario: Pi resets buffer on cached contexts
- **WHEN** the Pi engine reuses a cached `CommonToolContext` for a new execution
- **THEN** it replaces/resets `runtime.decisionBuffer` before the run (mirroring the loop-detector reset)

#### Scenario: Test contexts inject a fresh buffer via DI
- **WHEN** a unit/integration test invokes `executeCommonTool("decision_request", ...)` 
- **THEN** it SHALL inject a `CommonToolContext` whose `runtime.decisionBuffer` is a fresh `DecisionQuestionBuffer` (via a `makeDecisionCtx()` helper), mirroring production engine construction — never a bare `{}` context

### Requirement: Common tool handlers receive a context object
Each common tool handler SHALL receive a `CommonToolContext` containing scoped sub-objects: `task`, `repos`, `workflow`, and `runtime`. The context SHALL be constructed via constructor injection. No handler SHALL access global state.

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated and `runtime.decisionBuffer` populated

#### Scenario: Context populated by Claude engine
- **WHEN** the Claude engine executes a common tool call
- **THEN** it passes a `CommonToolContext` with `repos.decisions` populated and `runtime.decisionBuffer` populated

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All common tool handlers SHALL accept `args: Record<string, unknown>`. Handlers SHALL cast to the expected type after AJV validation has confirmed the value is safe. The test suite SHALL pass typed values (e.g. `{ task_id: 42 }`) and SHALL assert that string-where-number-expected produces a validation error.

#### Scenario: Typed task_id passes handler without cast errors
- **WHEN** `executeCommonTool("get_task", { task_id: 42 }, ctx)` is called
- **THEN** the handler receives `42` as a number and returns the task

#### Scenario: String-typed numeric arg is rejected by validation
- **WHEN** `executeCommonTool("get_task", { task_id: "42" }, ctx)` is called
- **THEN** `executeCommonTool` returns a validation error mentioning `task_id` type mismatch
