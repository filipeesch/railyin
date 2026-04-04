## ADDED Requirements

### Requirement: AI provider exposes a unified streaming method
The system SHALL provide an `AIProvider.stream()` method that accepts messages and tool definitions and yields typed stream events covering both text tokens and structured tool calls in a single call. The separate `chat()` method SHALL be removed.

#### Scenario: Model returns text in a single stream
- **WHEN** `stream()` is called and the model produces a text response with no tool calls
- **THEN** the stream yields one or more `token` events followed by a `done` event

#### Scenario: Model returns tool calls in a single stream
- **WHEN** `stream()` is called with tools and the model decides to call one or more tools
- **THEN** the stream yields a single `tool_calls` event containing all calls, then a `done` event; no `token` events are emitted for that round

#### Scenario: stream() always receives tool definitions
- **WHEN** `stream()` is called during any round of the tool loop, including the final round
- **THEN** tool definitions are included in the request so the model is never switched out of tool-aware mode

### Requirement: Engine tool loop uses unified stream for every round
The system SHALL drive the entire execution — tool rounds and final text response — from a single `stream()` call per round. The engine SHALL NOT make a separate second call to retrieve the final answer.

#### Scenario: Final response arrives in first stream with no tool calls
- **WHEN** the model produces a text response without calling any tools
- **THEN** that text is the final response, streamed live to the UI; no second call is made

#### Scenario: Tool call followed by final text in same session
- **WHEN** the model calls a tool in round N and then produces text in round N+1
- **THEN** the text from round N+1 is the final response, streamed live; total API calls equal number of rounds

## MODIFIED Requirements

### Requirement: AI responses are streamed and appended in real time
The system SHALL use server-sent events (SSE) streaming for AI responses. Tokens SHALL be appended to the conversation timeline as they arrive, providing real-time feedback in the task detail view. Streaming SHALL also handle structured tool call deltas in the same SSE stream — the engine does not require a separate non-streaming call for tool rounds.

#### Scenario: Tokens appear incrementally in task chat
- **WHEN** an execution is running and the AI is responding
- **THEN** the task detail view shows each token as it arrives without waiting for the full response

#### Scenario: Stream error marks execution as failed
- **WHEN** the SSE stream drops or returns an error before completion
- **THEN** the execution state is set to `failed`, any tokens already streamed are retained in the conversation, and a system message records the error

#### Scenario: Tool call deltas are accumulated across SSE chunks
- **WHEN** the SSE stream contains `delta.tool_calls` chunks with partial `arguments` JSON
- **THEN** the provider accumulates all chunks for each tool call index and yields a single `tool_calls` event only after `finish_reason` is received

### Requirement: AI provider abstraction supports future non-OpenAI providers
The system SHALL implement AI calls through an `AIProvider` interface with a single `stream()` method. The OpenAI-compatible implementation is the only concrete provider required for MVP.

#### Scenario: Provider interface is encapsulated
- **WHEN** the AI provider configuration changes
- **THEN** only the provider configuration and concrete implementation need updating — no changes to execution, conversation, or workflow engine code

#### Scenario: Provider that does not support streaming tool calls degrades gracefully
- **WHEN** a provider's SSE stream never emits `delta.tool_calls` chunks and responds with `finish_reason: "stop"`
- **THEN** the engine treats the response as a text-only final answer; tool calling still works if the provider supports it via its own SSE format
