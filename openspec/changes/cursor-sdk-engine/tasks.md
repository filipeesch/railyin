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
  - [x] 3.2.2 Handle `startRun` — call `Agent.create({ apiKey, model, local: { cwd, customTools } })`, stream events
  - [x] 3.2.3 Handle `cancelRun` — abort via `run.cancel()`
  - [x] 3.2.4 Handle `toolResult` — resolve the matching pending tool call
  - [x] 3.2.5 Handle `listModels` — proxy to `Cursor.models.list({ apiKey })`
  - [x] 3.2.6 Handle `shutdown` — cancel active runs, exit
  - [x] 3.2.7 Inline `translateCursorMessage` to avoid pulling TS into Node
- [x] 3.3 Implement `cursor/worker-client.ts` (Bun-side `SubprocessCursorAdapter`)
  - [x] 3.3.1 Lazily spawn the worker on first call; use `RAILYIN_CURSOR_NODE` if set, else `node`
  - [x] 3.3.2 Maintain `pending` map for `request → response` correlation
  - [x] 3.3.3 Maintain `runs` map; dispatch inbound `toolCall` to local `customTools.execute` and reply with `toolResult`
  - [x] 3.3.4 Adapt the run as an async iterable yielding `EngineEvent`s
  - [x] 3.3.5 On worker exit (or early child error before `ready`), surface fatal `EngineEvent.error` to every active run and reject `workerReady`
- [x] 3.4 Switch `createDefaultCursorSdkAdapter()` to return `SubprocessCursorAdapter`; remove all in-process HTTP/2 monkey-patches

## 4. Engine Registration

- [x] 4.1 Add `CursorEngine` import to `src/bun/index.ts`
- [x] 4.2 Add factory entry in `engineFactories` for "cursor"
- [x] 4.3 Add cursor engine to `buildEngineInstances()` call

## 5. Testing

- [ ] 5.1 Create `src/bun/test/support/cursor-sdk-mock.ts` with an in-process mock `CursorSdkAdapter`
- [ ] 5.2 Create `src/bun/test/cursor-sdk-adapter.test.ts` covering event translation, suspend-loop handling, and cancellation
- [ ] 5.3 Create `src/bun/test/cursor-rpc-scenarios.test.ts` reusing `shared-rpc-scenarios.ts`
  - [ ] 5.3.1 Single-turn chat scenario
  - [ ] 5.3.2 Multi-turn chat scenario
  - [ ] 5.3.3 Tool success scenario
  - [ ] 5.3.4 Tool failure scenario
  - [ ] 5.3.5 ask_user / decision_request suspension scenario
  - [ ] 5.3.6 Cancellation scenario
  - [ ] 5.3.7 Fatal failure scenario
  - [ ] 5.3.8 Model listing scenario
- [ ] 5.4 Subprocess-specific tests
  - [ ] 5.4.1 Worker boot + `ready` handshake
  - [ ] 5.4.2 Worker crash mid-run surfaces fatal `EngineEvent.error` and respawns on next call
  - [ ] 5.4.3 `toolCall` ↔ `toolResult` round-trip via the IPC channel
