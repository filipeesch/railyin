## Purpose

Defines the test coverage requirements for the OpenCode engine — unit tests for event translation and attachment mapping, integration tests for RPC scenarios and session lifecycle, and config validation tests. All tests use dependency injection via `MockOpenCodeSdkAdapter` and run under the existing `bun test src/bun/test` suite.

## Requirements

### Requirement: OpenCode SSE event translation is fully unit tested

The test suite SHALL contain unit tests for every `Part` event type handled by `event-translator.ts`. Each test SHALL call the translation function directly with a fabricated event and assert the exact `EngineEvent` value returned.

#### Scenario: TextPart produces a token event

- **WHEN** `translatePart()` receives an `EventMessagePartUpdated` event containing a `TextPart` with `.content = "hello"`
- **THEN** the function returns `{ type: "token", content: "hello" }`

#### Scenario: ReasoningPart produces a reasoning event

- **WHEN** `translatePart()` receives an `EventMessagePartUpdated` event containing a `ReasoningPart`
- **THEN** the function returns `{ type: "reasoning", content }`

#### Scenario: ToolPart in running state produces tool_start

- **WHEN** `translatePart()` receives a `ToolPart` with `state: "running"`
- **THEN** the function returns `{ type: "tool_start", name, arguments }`

#### Scenario: ToolPart in completed state produces tool_result

- **WHEN** `translatePart()` receives a `ToolPart` with `state: "completed"`
- **THEN** the function returns `{ type: "tool_result", name, result }`

#### Scenario: ToolPart in error state produces error tool_result

- **WHEN** `translatePart()` receives a `ToolPart` with `state: "error"`
- **THEN** the function returns `{ type: "tool_result", name, result, isError: true }`

#### Scenario: EventPermissionUpdated produces shell_approval

- **WHEN** the event translator receives an `EventPermissionUpdated`
- **THEN** it returns `{ type: "shell_approval", command, executionId }`

#### Scenario: EventSessionIdle produces done

- **WHEN** the event translator receives an `EventSessionIdle`
- **THEN** it returns `{ type: "done" }`

#### Scenario: EventSessionStatus retry produces status

- **WHEN** the event translator receives an `EventSessionStatus` with `type: "retry"`
- **THEN** it returns `{ type: "status", message }`

#### Scenario: Token counts produce usage event

- **WHEN** `EventMessageUpdated` contains input/output token counts
- **THEN** it returns `{ type: "usage", inputTokens, outputTokens }`

#### Scenario: Unknown event type yields nothing without throwing

- **WHEN** the translator receives an unrecognised event type
- **THEN** it returns `undefined` or an empty result and does not throw

### Requirement: Attachment mapping is fully unit tested

The test suite SHALL contain unit tests for `attachment-mapper.ts` covering all input shapes.

#### Scenario: File attachment maps to FilePartInput

- **WHEN** `mapAttachments()` receives a Railyin file attachment with a path
- **THEN** it returns `[{ type: "file", source: { type: "file", path } }]`

#### Scenario: Empty attachments array maps to empty array

- **WHEN** `mapAttachments()` receives an empty array
- **THEN** it returns `[]`

#### Scenario: Undefined attachments maps to empty array

- **WHEN** `mapAttachments()` receives `undefined`
- **THEN** it returns `[]`

### Requirement: OpenCodeEngineConfig validation is unit tested

The test suite SHALL contain config validation unit tests using the `loadConfig` + `resetConfig` pattern from `config-path-validation.test.ts`.

#### Scenario: Valid opencode config with provider loads successfully

- **WHEN** `workspace.yaml` has `engine.type: opencode`, a default `model`, and a `providers` map with one entry
- **THEN** `loadConfig()` returns a non-null config with no error

#### Scenario: Valid opencode config with no providers loads successfully

- **WHEN** `workspace.yaml` has `engine.type: opencode` and no `providers` field
- **THEN** `loadConfig()` returns a non-null config (providers are optional)

#### Scenario: Opencode config with local LLM provider loads successfully

- **WHEN** a provider entry has `npm: "@ai-sdk/openai-compatible"` and `base_url` set
- **THEN** `loadConfig()` returns a non-null config

### Requirement: OpenCode RPC integration tests cover all shared engine scenarios

The test suite SHALL contain an `opencode-rpc-scenarios.test.ts` file that creates a `BackendRpcRuntime` with `MockOpenCodeSdkAdapter` and runs all shared RPC scenario functions.

#### Scenario: Single-turn and multi-turn chat via shared scenarios

- **WHEN** `runSingleTurnChatScenario` and `runMultiTurnChatScenario` are executed with an OpenCode runtime
- **THEN** both pass: messages are persisted, execution reaches completed status

#### Scenario: Tool success and failure via shared scenarios

- **WHEN** `runToolSuccessScenario` and `runToolFailureScenario` are executed
- **THEN** tool_call and tool_result messages are persisted with correct is_error flag

#### Scenario: Ask-user suspension and resume via shared scenarios

- **WHEN** `runAskUserScenario` and `runAskUserResumeScenario` are executed
- **THEN** execution reaches waiting_user state and resumes correctly

#### Scenario: Cancellation via shared scenarios

- **WHEN** `runCancellationScenario` is executed
- **THEN** execution is cancelled and stream terminates

#### Scenario: Fatal failure via shared scenarios

- **WHEN** `runFatalFailureScenario` is executed
- **THEN** execution reaches failed status and error message is persisted

#### Scenario: Model listing via shared scenarios

- **WHEN** `runModelListingScenario` is executed
- **THEN** models from the mock adapter are returned

### Requirement: OpenCode session lifecycle is verified by integration tests

#### Scenario: First execute creates a new session

- **WHEN** `OpenCodeEngine.execute()` is called with a fresh `conversationId`
- **THEN** `mock.trace.createCalls` has one entry with the correct `conversationId` and `directory`

#### Scenario: Second execute for same conversation resumes the session

- **WHEN** `OpenCodeEngine.execute()` is called twice with the same `conversationId`
- **THEN** `mock.trace.createCalls` has exactly one entry and `mock.trace.resumeCalls` has one entry

#### Scenario: Different conversationIds create independent sessions

- **WHEN** `OpenCodeEngine.execute()` is called with two distinct `conversationId` values
- **THEN** `mock.trace.createCalls` has two entries, one per conversation

#### Scenario: Execution context is removed after successful execution

- **WHEN** an execution completes normally
- **THEN** `mock.activeContexts` does not contain the `conversationId`

#### Scenario: Execution context is removed after failed execution

- **WHEN** an execution throws a fatal error
- **THEN** `mock.activeContexts` does not contain the `conversationId`

### Requirement: MockOpenCodeSdkAdapter implements OpenCodeSdkAdapter interface

The mock adapter SHALL implement `OpenCodeSdkAdapter` via TypeScript's `implements` keyword, ensuring compile-time enforcement that the mock stays in sync with the production interface.

#### Scenario: Mock satisfies interface contract at compile time

- **WHEN** `MockOpenCodeSdkAdapter` is compiled
- **THEN** it satisfies the `OpenCodeSdkAdapter` interface without type errors
