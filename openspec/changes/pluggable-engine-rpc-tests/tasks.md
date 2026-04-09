## 1. Coordinator seam

- [x] 1.1 Introduce an execution coordinator contract that matches the task RPC handler operations
- [x] 1.2 Update task RPC handlers and production wiring to depend on the coordinator contract instead of the concrete orchestrator type
- [x] 1.3 Preserve current production behavior by adapting the existing orchestrator to the new coordinator contract

## 2. Copilot SDK adapter injection

- [x] 2.1 Extract a Copilot SDK adapter abstraction from the current module-level Copilot session helpers
- [x] 2.2 Update `CopilotEngine` to use the injected SDK adapter for session lifecycle, abort, disconnect, and model listing
- [x] 2.3 Provide the default production Copilot SDK adapter backed by `@github/copilot-sdk`
- [x] 2.4 Add deterministic Copilot SDK mock classes that can script streaming, tool, failure, cancellation, and model-list scenarios

## 3. Shared backend runtime harness

- [x] 3.1 Create a backend scenario runtime factory that assembles in-memory DB fixtures, task handlers, callback recorders, and database probes
- [x] 3.2 Add waiters that settle scenarios from callback and persisted-state barriers instead of fixed sleeps
- [x] 3.3 Add engine-specific runtime builders so tests can inject the real Copilot engine with mocked SDK classes and future engines through the same runtime contract

## 4. Shared scenario coverage

- [x] 4.1 Add shared backend RPC scenarios for single-turn and multi-turn chat conversations
- [x] 4.2 Add shared backend RPC scenarios for tool-call success and tool-call failure persistence
- [x] 4.3 Add shared backend RPC scenarios for ask-user suspension and resumable cancellation behavior
- [x] 4.4 Add shared backend RPC scenarios for fatal SDK failures and model-listing behavior
- [x] 4.5 Add Copilot-specific backend scenarios for session resume, create fallback, and abort/disconnect cleanup

## 5. Cancellation semantics and verification

- [x] 5.1 Update non-native orchestrator cancellation handling so execution rows become `cancelled` and task rows become `waiting_user`
- [x] 5.2 Verify shared scenarios assert that no additional tokens or assistant completions are emitted after cancellation
- [x] 5.3 Run the backend scenario suite and fix any mismatches between Copilot engine behavior, orchestrator persistence, and the new specs
