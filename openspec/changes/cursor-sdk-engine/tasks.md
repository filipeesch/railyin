## 1. Configuration

- [x] 1.1 Add `CursorEngineConfig` interface to `src/bun/config/index.ts`
- [x] 1.2 Update `EngineConfig` union type to include `CursorEngineConfig`
- [x] 1.3 Add cursor engine to `config/engines.yaml.sample` with comment (`api_key` field documented)

## 2. Engine Files

- [x] 2.1 Create `src/bun/engine/cursor/` directory
- [x] 2.2 Implement `adapter.ts` exposing `CursorSdkAdapter`, `CursorRunConfig`, `CursorAdapterOptions`, and `createDefaultCursorSdkAdapter()`
  - [x] 2.2.1 Define `CursorSdkAdapter` interface (`run`, `cancel`, `listModels`, `listCommands`, `shutdownAll`)
  - [x] 2.2.2 Factory returns `SubprocessCursorAdapter` (in-process implementation removed — see Decision 6)
- [x] 2.3 Implement `engine.ts` with `CursorEngine` class
  - [x] 2.3.1 Implement `execute()` method that wires `customTools`, `onSuspend`, and forwards to the adapter
  - [x] 2.3.2 Implement `resume()` method — throws to force `HumanTurnExecutor` fresh-execution path
  - [x] 2.3.3 Implement `cancel()` method via the shared `AbortController`
  - [x] 2.3.4 Implement `listModels()` mapping SDK ids to `cursor/${id}` qualified ids
  - [x] 2.3.5 Implement `listCommands()` (returns empty — SDK does not surface commands here)
  - [x] 2.3.6 Read saved `agentId` via `CursorSessionRepository.getAgentId(conversationId)` and pass it through `runConfig.agentId`; persist new ids via `runConfig.onAgentCreated` (Decision 2)
  - [x] 2.3.7 `touch()` the row on resume so `last_used_at` reflects activity
- [x] 2.4 Implement `events.ts` with event translation functions
  - [x] 2.4.1 Map `SDKMessage` to `EngineEvent` types
  - [x] 2.4.2 Handle token streaming from `assistant` messages
  - [x] 2.4.3 Handle reasoning from `thinking` messages
  - [x] 2.4.4 Handle `tool_start` and `tool_result` from `tool_call` messages
  - [x] 2.4.5 Handle `status` messages
- [x] 2.5 Implement `tools.ts` with common tool registration
  - [x] 2.5.1 Register `COMMON_TOOL_DEFINITIONS` (tasks_read/write, decision_request, notes, etc.) as `customTools`
  - [x] 2.5.2 Register MCP-registry tools as `customTools` (filtered by `enabledMcpTools`)
  - [x] 2.5.3 Register `railyin_shell` / `railyin_grep` / `railyin_glob` / `railyin_read` bypass tools and inject prompt steering toward them

## 3. Subprocess Isolation (Bun HTTP/2 workaround)

- [x] 3.1 Define IPC wire types in `cursor/worker-protocol.ts` (BunToWorker / WorkerToBun)
- [x] 3.2 Implement `cursor/worker.mjs` (Node ESM — the only `.mjs` file in the codebase)
  - [x] 3.2.1 Boot, signal `ready`
  - [x] 3.2.2 Handle `startRun` — try `Agent.resume(agentId, ...)` when `agentId` is provided; fall back to `Agent.create(...)` and emit `agentCreated` with the new id; stream events
  - [x] 3.2.3 Handle `cancelRun` — abort via `run.cancel()`
  - [x] 3.2.4 Handle `toolResult` — resolve the matching pending tool call
  - [x] 3.2.5 Handle `listModels` — proxy to `Cursor.models.list({ apiKey })`
  - [x] 3.2.6 Handle `shutdown` — cancel active runs, exit
  - [x] 3.2.7 Inline `translateCursorMessage` to avoid pulling TS into Node
  - [x] 3.2.8 Call `events.setMaxListeners(0)` at startup — defensive against SDK abort-listener accumulation across many `Agent.resume()`/`Agent.create()` calls in a long-lived worker
- [x] 3.3 Implement `cursor/worker-client.ts` (Bun-side `SubprocessCursorAdapter`)
  - [x] 3.3.1 Lazily spawn the worker on first call; use `RAILYIN_CURSOR_NODE` if set, else `node`
  - [x] 3.3.2 Maintain `pending` map for `request → response` correlation
  - [x] 3.3.3 Maintain `runs` map; dispatch inbound `toolCall` to local `customTools.execute` and reply with `toolResult`
  - [x] 3.3.4 Adapt the run as an async iterable yielding `EngineEvent`s
  - [x] 3.3.5 On worker exit (or early child error before `ready`), surface fatal `EngineEvent.error` to every active run and reject `workerReady`
- [x] 3.4 Switch `createDefaultCursorSdkAdapter()` to return `SubprocessCursorAdapter`; remove all in-process HTTP/2 monkey-patches

## 4. Session Persistence

- [x] 4.1 Add migration `src/bun/db/migrations/049_cursor_sessions.ts` creating `cursor_sessions(conversation_id PK, agent_id, created_at, last_used_at)` with `ON DELETE CASCADE` from `conversations`
- [x] 4.2 Add `src/bun/db/repositories/cursor-session-repository.ts` exposing `getAgentId`, `upsert`, `touch`, `delete`
- [x] 4.3 Extend `CursorRunConfig` with optional `agentId` and `onAgentCreated(agentId)` callback
- [x] 4.4 Extend worker IPC: `StartRunRequest.agentId?` (Bun→worker) and `AgentCreatedMessage { runId, agentId }` (worker→Bun)
- [x] 4.5 `SubprocessCursorAdapter.run` forwards `agentId` to the worker and dispatches `agentCreated` to the run's `onAgentCreated`

## 5. Engine Registration

- [x] 5.1 Add `CursorEngine` import to `src/bun/index.ts`
- [x] 5.2 Add factory entry in `engineFactories` for "cursor"
- [x] 5.3 Add cursor engine to `buildEngineInstances()` call

## 6. Testing

- [x] 6.1 Mock `CursorSdkAdapter` + RPC runtime exist as `src/bun/test/cursor/mocks.ts` and `src/bun/test/support/cursor-rpc-runtime.ts`
- [ ] 6.2 Adapter unit tests covering event translation, suspend-loop handling, and cancellation
  - [x] 6.2.1 Event translation (assistant → token, thinking → reasoning, tool_call) — `src/bun/test/cursor/adapter.test.ts`
  - [x] 6.2.2 Cancellation — `src/bun/test/cursor/adapter.test.ts`
  - [ ] 6.2.3 Suspend-loop (`onSuspend` → `decision_request` event after stream cut)
- [ ] 6.3 Integration scenarios in `src/bun/test/cursor/integration.test.ts` (reusing `shared-rpc-scenarios.ts` where applicable)
  - [x] 6.3.1 Single-turn chat scenario
  - [ ] 6.3.2 Multi-turn chat scenario
  - [ ] 6.3.3 Tool success scenario
  - [ ] 6.3.4 Tool failure scenario
  - [~] 6.3.5 ask_user / decision_request suspension scenario (smoke-only; does not yet assert the `decision_request` event payload)
  - [ ] 6.3.6 Cancellation scenario
  - [ ] 6.3.7 Fatal failure scenario
  - [ ] 6.3.8 Model listing scenario
- [ ] 6.4 Subprocess-specific tests
  - [ ] 6.4.1 Worker boot + `ready` handshake
  - [ ] 6.4.2 Worker crash mid-run surfaces fatal `EngineEvent.error` and respawns on next call
  - [ ] 6.4.3 `toolCall` ↔ `toolResult` round-trip via the IPC channel
- [ ] 6.5 Session-persistence tests
  - [ ] 6.5.1 First turn on a conversation creates a fresh agent and persists the returned `agent_id` in `cursor_sessions`
  - [ ] 6.5.2 Second turn on the same conversation resumes the persisted `agent_id` (no `Agent.create` call)
  - [ ] 6.5.3 `Agent.resume` failure falls back to `Agent.create` and overwrites the stored id
  - [ ] 6.5.4 Deleting a conversation cascades to its `cursor_sessions` row
