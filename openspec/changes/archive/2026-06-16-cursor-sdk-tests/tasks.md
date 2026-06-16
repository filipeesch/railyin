## 1. Mock SDK Implementation

- [x] 1.1 Create `src/bun/test/cursor/mocks.ts` with `MockCursorSdkAdapter` (copilot-style queue/step-builder API)
  - [x] 1.1.1 Async generator `run()` streams queued steps as `EngineEvent`s (token, reasoning, tool_start, tool_result, status, error)
  - [x] 1.1.2 `queueTurn({ steps, sendError? })` enqueues one turn per upcoming `adapter.run()` call
  - [x] 1.1.3 `cancel()`, `shutdownAll()`, `signal`-aware `waitForAbort` step
  - [x] 1.1.4 `callTool` step invokes the supplied `customTools[name].execute(args)` so suspend-loop tools (decision_request) trigger the engine's `onSuspend` callback exactly as in production
  - [x] 1.1.5 Step builders exported: `token`, `reasoning`, `toolStart`, `toolResult`, `statusMessage`, `askUser`, `callTool`, `waitForAbort`, `fatalError`
- [x] 1.2 Adapter tests in `src/bun/test/cursor/adapter.test.ts`
  - [x] 1.2.1 Event translation (token, reasoning, status, tool_start/result, askUser)
  - [x] 1.2.2 `listModels()` returns the configured Cursor model info (default mock model + `setModels` override)
  - [x] 1.2.3 `cancel()` and signal-aborted runs omit the terminal `done` (matches production `SubprocessCursorAdapter`)
  - [x] 1.2.4 `listCommands()` returns an empty array (Cursor has no slash commands)
  - [x] 1.2.5 Suspend-loop via `callTool` — the custom tool's `onSuspend` side-effect aborts the run and the post-suspend steps are skipped

## 2. Integration Tests

- [x] 2.1 Engine-agnostic shared scenarios wired in `src/bun/test/cursor/rpc-scenarios.test.ts` via `src/bun/test/support/shared-rpc-scenarios.ts`
  - [x] 2.1.1 Single-turn chat — `runSingleTurnChatScenario`
  - [x] 2.1.2 Multi-turn chat — `runMultiTurnChatScenario`
  - [x] 2.1.3 Tool success — `runToolSuccessScenario`
  - [x] 2.1.4 Tool failure — `runToolFailureScenario`
  - [x] 2.1.5 Suspend — cursor uses the `decision_request` path (not `ask_user`); follow-up message starts a fresh execution (CursorEngine.resume throws by contract)
  - [x] 2.1.6 Cancellation — `runCancellationScenario`
  - [x] 2.1.7 Fatal failure — `runFatalFailureScenario` (turn `sendError`) + streamed `error` event variant
  - [x] 2.1.8 Model listing — `runModelListingScenario`

## 3. Playwright UI Tests

- [x] 3.1 Create `e2e/ui/cursor.spec.ts` — 5 tests covering picker exposure, selection, streaming, tool rendering, and decision_request
  - [x] 3.1.1 CU-1.1 — model picker exposes `cursor/*` models (with multi-engine group header)
  - [x] 3.1.2 CU-1.2 — selecting a cursor model updates the task model via `tasks.setModel` + `task.updated`
  - [x] 3.1.3 CU-2.1 — `text_chunk` events from a cursor-model task render under `.msg--assistant`
  - [x] 3.1.4 CU-3.1 — `tool_call` + `tool_result` (e.g. `railyin_shell`) render under `.conversation-inner .tc`
  - [x] 3.1.5 CU-4.1 — `decision_request_prompt` renders the interview UI under a cursor-model task (cursor uses decision_request, not ask_user)
