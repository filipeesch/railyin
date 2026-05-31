# Pi Engine Parallelism

## Purpose

Specifies how the Pi engine leverages parallel request capacity on local LLM servers (vLLM, Ollama, LM Studio) through provider concurrency limiting, connection pooling, a `delegate` tool for fan-out sub-conversations, and opportunistic background compaction.

## Requirements

### Requirement: Per-provider concurrency limiter

The Pi engine SHALL maintain one bounded concurrency limiter per provider name (as keyed in `PiEngineConfig.providers`). Every LLM HTTP request originating from any `AgentSession` created by the Pi engine — including parent sessions, child sessions spawned via the `delegate` tool, and background compaction calls — SHALL acquire a slot from the matching limiter before issuing the request and SHALL release the slot when the response stream terminates (success, error, or abort). The limiter SHALL implement a FIFO wait queue with abort-aware acquisition.

#### Scenario: Default `max_inflight` is 8
- **WHEN** a Pi provider entry is configured without an explicit `max_inflight`
- **THEN** the limiter for that provider is created with `max_inflight = 8`

#### Scenario: Slot count enforced across all sessions
- **WHEN** a provider has `max_inflight = 2` and three concurrent Pi sessions (parent + 2 children) attempt to issue LLM requests at the same instant
- **THEN** exactly two requests are dispatched immediately and the third is queued until one of the first two releases its slot

#### Scenario: Aborted waiter releases its queue position
- **WHEN** a session is waiting in the limiter queue and its abort signal fires
- **THEN** the waiter's acquire promise rejects, the queue entry is removed, and the slot count is not consumed

#### Scenario: Release after request error
- **WHEN** an in-flight request errors before completion
- **THEN** the limiter slot is released and the next queued waiter (if any) is woken

#### Scenario: LM Studio default-mismatch warning
- **WHEN** the engine starts and any provider has `max_inflight > 2` with a `base_url` whose host is `localhost` or `127.0.0.1` and port is `1234`
- **THEN** a single warning is logged identifying the provider and recommending `max_inflight: 2`

### Requirement: Shared HTTP connection pool per `base_url`

The Pi engine SHALL maintain one shared `undici.Agent` (or equivalent HTTP keep-alive pool) per distinct provider `base_url`. All LLM requests to the same `base_url` SHALL reuse this pool. The pool SHALL be configured with `keepAlive: true`.

#### Scenario: Sockets reused across sessions
- **WHEN** five sequential LLM requests are issued from different `AgentSession` instances to the same provider `base_url`
- **THEN** the requests share underlying TCP sockets via the keep-alive pool rather than opening a new connection per request

### Requirement: Transport wrapper routes all Pi LLM calls through the limiter

`defaultSessionFactory` SHALL install a custom `Transport` (via `AgentOptions.transport`) on every `AgentSession` it creates. The transport SHALL resolve the provider name from the model's `provider` field, await `limiter.acquire(provider, signal)` before invoking the underlying HTTP stream, and release the slot when the stream terminates.

#### Scenario: Transport installed on every session
- **WHEN** any `AgentSession` is created by the Pi engine (parent, child, or otherwise)
- **THEN** its `transport` is the limiter-wrapped transport, not the SDK default

#### Scenario: Transport release on early stream abort
- **WHEN** the underlying HTTP stream is aborted mid-response
- **THEN** the limiter slot is released exactly once

### Requirement: `delegate` tool for parallel sub-conversations

The Pi engine SHALL expose a tool named `delegate` whose parameters are `{ tasks: Array<{ id: string; prompt: string; tools?: ("read"|"write"|"shell"|"web")[] }>, max_concurrency?: number }`. When the parent agent invokes `delegate`, the engine SHALL:

1. Validate that `tasks.length` is between 1 and `harness.delegate.max_per_call` (default 5), all `id` values are non-empty and unique within the call, and every `tools` entry is contained in `harness.delegate.allow_tools` (default `["read","write","shell"]`).
2. Spawn one fresh in-memory `AgentSession` per task operating on the shared parent worktree, with a tool set covering the requested groups (default `read`, `write`, `shell`); the child tool set SHALL NOT contain `delegate` (no recursive fan-out) or any board-mutating common tool (`create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`), decision tool, or note tool. Children DO receive the TODO tools to track their own work.
3. Run children concurrently with internal concurrency `min(max_concurrency, harness.delegate.max_per_call, tasks.length, providerLimiter.max_inflight)`.
4. Use `Promise.allSettled` so per-child errors do not abort the batch.
5. Return a single markdown digest as the tool result with one `### {id}` section per task (final assistant text or formatted error), plus `details: { jobs: Array<{ id: string; status: "ok"|"error"; durationMs: number; tokens?: number }> }`.
6. Dispose every child session in a `finally` block, including deletion of any temporary session files.

#### Scenario: N independent prompts run concurrently
- **WHEN** the parent emits `delegate` with three tasks and `provider.max_inflight ≥ 3`
- **THEN** three LLM requests to the provider are in flight at the same instant

#### Scenario: Per-job error isolation
- **WHEN** one of three child tasks throws and the other two succeed
- **THEN** the tool result includes the two successes and a structured error section for the failing task, and the parent receives one tool result (no error event)

#### Scenario: Child tool set is writable by default
- **WHEN** a task is dispatched without specifying `tools`
- **THEN** the child session's active tool set contains the SDK built-ins, the `read`, `write`, and `shell` group tools (`write_file`, `patch_file`, `delete_file`, `run_command`), and the TODO common tools, but NOT `delegate`, `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `record_decision`, `decision_request`, or note tools

#### Scenario: Recursive delegation rejected
- **WHEN** a child task is dispatched and the child agent attempts to call `delegate`
- **THEN** the child does not have the `delegate` tool registered and the call fails as an unknown-tool error

#### Scenario: Disallowed tool group rejected at validation
- **WHEN** a task specifies `tools: ["shell"]` and `harness.delegate.allow_tools` is `["read"]`
- **THEN** the entire `delegate` invocation fails immediately with an error result that names the rejected group, and no children are spawned

#### Scenario: max_per_call enforced
- **WHEN** a `delegate` call contains 6 tasks and `harness.delegate.max_per_call` is 5
- **THEN** the tool returns an error result and no children are spawned

#### Scenario: Parent abort cancels all children
- **WHEN** the parent execution's abort signal fires while children are running
- **THEN** every child session's `abort()` is invoked, all limiter slots held by children are released, and the `delegate` tool result is not produced

#### Scenario: Final result digest format
- **WHEN** `delegate` finishes with task `a` succeeding and task `b` failing
- **THEN** the markdown content contains a `### a` section with `a`'s final assistant text and a `### b` section whose body begins with `**error**:`

#### Scenario: Child session temp files cleaned up
- **WHEN** a `delegate` invocation completes (success or failure)
- **THEN** no `delegate-${parentConversationId}/` files remain under `~/.railyin/pi-sessions/`

### Requirement: Live per-child progress via parentCallId nesting

While children are running, each child's `tool_start` and `tool_result` events SHALL be emitted on the parent execution stream with `parentCallId` set to the `delegate` tool call's `callId` and `isInternal: true`. These events SHALL be visible to the UI only — they SHALL NOT be appended to the parent agent's context.

The UI renders them as collapsible nested cards under the `delegate` tool call using the existing `parentCallId` rendering (S-26 pattern). No new `EngineEvent` types or UI components are required.

Because child tool `callId`s are only unique within a child session, they can collide with a parent `callId`, collide with a parallel sibling child, or be reused across sequential tool calls within one child (local models such as vLLM/Qwen emit ids like `call_0` repeatedly). The frontend stream store keys live blocks by `blockId`, so the engine SHALL assign each child tool-call occurrence a globally-unique LIVE `blockId` (namespaced by the parent bubble plus a monotonic per-execution counter). The matching `tool_result` and any child `file_diff` SHALL reuse that exact live `blockId`. Persisted `conversation_messages` SHALL keep the raw `callId` (history nests via `parent_tool_call_id`), so reload behaviour is unchanged.

#### Scenario: Child tool events nested under delegate card
- **WHEN** a child invokes a tool (e.g. `read_file`)
- **THEN** a `tool_start` event with `parentCallId = delegate_tool_call_id` and `isInternal: true` is emitted on the parent stream, and the UI renders it as a child card under the `delegate` tool call

#### Scenario: Parallel children with colliding callIds stay distinct
- **WHEN** two parallel children each emit a tool call with the same raw `callId` (e.g. `call_0`)
- **THEN** each child's `tool_call` and `tool_result` receive distinct live `blockId`s namespaced by their own bubble, and the UI nests each under its own bubble

#### Scenario: Single child reusing a callId sequentially stays distinct
- **WHEN** one child emits two sequential tool calls that reuse the same raw `callId` (e.g. `call_0` twice)
- **THEN** each occurrence receives a distinct live `blockId`, both nest under the bubble, and each `tool_result` resolves to its own occurrence

#### Scenario: Parent agent does not see child updates
- **WHEN** the parent's next assistant turn begins after `delegate` completes
- **THEN** the parent's context contains exactly one tool result for `delegate` (the digest) and none of the intermediate child tool events

### Requirement: Child raw-model events forwarded with parent linkage

When `onRawModelMessage` is provided to a Pi execution that invokes `delegate`, every raw inbound model event from any child session SHALL be forwarded through the same callback with `parentToolCallId` set to the `delegate` tool call id and `sessionId` set to `"${parentConversationId}/${jobId}"`.

#### Scenario: Child events tagged for raw-events panel
- **WHEN** the parent has `onRawModelMessage` wired and three children stream responses
- **THEN** every child's inbound events arrive at the callback with the parent's `delegate` tool call id as `parentToolCallId`

### Requirement: Opportunistic background compaction

After each `turn_end` event on a parent Pi `AgentSession`, the engine SHALL check whether to trigger background compaction using the following rule:

```
softThreshold = contextWindow - (reserveTokens + harness.background_compaction.early_margin_tokens)

if harness.background_compaction.enabled (default true)
   and session.getContextUsage().tokens >= softThreshold
   and !session.isCompacting
   and no background compaction is currently in flight for this conversation
   and limiter.tryAcquire(provider) returns a release token
then
   start session.compact() asynchronously (fire-and-forget)
   release the slot when compaction settles
else
   do nothing
```

`early_margin_tokens` SHALL default to 8192 and SHALL be greater than zero. The SDK's hard threshold (`contextWindow - reserveTokens`) SHALL remain active as a safety net and SHALL NOT be disabled.

#### Scenario: Fires when slot is free
- **WHEN** context usage crosses the soft threshold at `turn_end` and the limiter has at least one free slot
- **THEN** `session.compact()` is invoked asynchronously and the next assistant turn can begin without waiting for it

#### Scenario: Skipped when limiter saturated
- **WHEN** context usage crosses the soft threshold at `turn_end` and the limiter has zero free slots
- **THEN** no background compaction is started; the SDK's hard threshold continues to apply on the next turn

#### Scenario: No double-trigger
- **WHEN** a background compaction is already in flight for the conversation and a subsequent `turn_end` would otherwise trigger another one
- **THEN** no second compaction is started

#### Scenario: Soft threshold below hard threshold
- **WHEN** any valid `harness.background_compaction` configuration is loaded
- **THEN** the soft threshold is strictly less than `contextWindow - reserveTokens`

#### Scenario: Summary persisted on success
- **WHEN** a background compaction completes successfully with a non-empty `summary`
- **THEN** the summary is appended to the conversation as a `compaction_summary` message via `appendMessage`

### Requirement: Shutdown cancels in-flight background compactions

`PiEngine.shutdown()` SHALL invoke `session.cancelCompaction()` on every session that has a background compaction in flight before disposing the session.

#### Scenario: Background compaction aborted on shutdown
- **WHEN** the engine shuts down while one conversation has a background compaction running
- **THEN** that session's `cancelCompaction()` is called prior to disposal and `shutdown()` resolves without hanging

### Requirement: Configuration surface

`PiEngineConfig` SHALL accept the following additional fields:

```
providers: Record<string, {
  base_url: string;
  api_key?: string;
  max_inflight?: number;       // default 8
  queue_timeout_ms?: number;   // default 60_000
}>

harness: {
  undo_stack_size?: number;    // pre-existing
  delegate?: {
    enabled?: boolean;         // default true
    max_per_call?: number;     // default 5, must be 1..10
    max_concurrency?: number;  // optional; default derived as min(max_per_call, provider.max_inflight)
    allow_tools?: ("read"|"write"|"shell"|"web")[]; // default ["read","write","shell"]
  };
  background_compaction?: {
    enabled?: boolean;            // default true
    early_margin_tokens?: number; // default 8192, must be >= 1024
  };
}
```

Loaded configuration values SHALL be validated at engine construction time; invalid values SHALL cause the engine to refuse to start with a clear error message.

#### Scenario: Invalid `max_per_call` rejected
- **WHEN** `harness.delegate.max_per_call` is set to 0 or 11
- **THEN** the engine fails to start and the error message names the offending field

#### Scenario: Invalid `early_margin_tokens` rejected
- **WHEN** `harness.background_compaction.early_margin_tokens` is set below 1024
- **THEN** the engine fails to start and the error message names the offending field

#### Scenario: `queue_timeout_ms` honoured
- **WHEN** a waiter has been queued longer than `provider.queue_timeout_ms`
- **THEN** the waiter's acquire promise rejects with a clear timeout error and the queue entry is removed

### Requirement: Provider metrics surfaced via helper

The Pi engine SHALL expose a `getPiProviderStatus()` helper returning, for each configured provider: `inFlight: number`, `queueDepth: number`, `p50LatencyMs: number | null`, `recentRejectCount: number`. The helper SHALL be safe to call from any thread and SHALL NOT modify limiter state.

#### Scenario: Snapshot includes every configured provider
- **WHEN** `getPiProviderStatus()` is called and two providers are configured
- **THEN** the returned snapshot contains one entry per provider name with the four fields populated
