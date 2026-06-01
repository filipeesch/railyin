## 1. Configuration

- [ ] 1.1 Add `CursorEngineConfig` interface to `src/bun/config/index.ts`
- [ ] 1.2 Update `EngineConfig` union type to include `CursorEngineConfig`
- [ ] 1.3 Add cursor engine to `config/engines.yaml.sample` with comment

## 2. Engine Files

- [ ] 2.1 Create `src/bun/engine/cursor/` directory
- [ ] 2.2 Implement `adapter.ts` with `CursorSdkAdapter` class
  - [ ] 2.2.1 Create `CursorSdkAdapter` class
  - [ ] 2.2.2 Implement `run()` method that wraps `Agent.create()` / `Agent.resume()`
  - [ ] 2.2.3 Implement `cancel()` method
  - [ ] 2.2.4 Implement `listModels()` method
  - [ ] 2.2.5 Implement `listCommands()` method
- [ ] 2.3 Implement `engine.ts` with `CursorEngine` class
  - [ ] 2.3.1 Implement `execute()` method that calls adapter's `run()`
  - [ ] 2.3.2 Implement `resume()` method for ask_user / shell_approval resumption
  - [ ] 2.3.3 Implement `cancel()` method
  - [ ] 2.3.4 Implement `listModels()` method
  - [ ] 2.3.5 Implement `listCommands()` method
- [ ] 2.4 Implement `events.ts` with event translation functions
  - [ ] 2.4.1 Map SDKMessage to EngineEvent types
  - [ ] 2.4.2 Handle token streaming from assistant messages
  - [ ] 2.4.3 Handle reasoning from thinking messages
  - [ ] 2.4.4 Handle tool_start and tool_result from tool_call messages
  - [ ] 2.4.5 Handle status messages
- [ ] 2.5 Implement `tools.ts` with common tool registration
  - [ ] 2.5.1 Register tasks_read tools (get_task, list_tasks, get_board_summary)
  - [ ] 2.5.2 Register tasks_write tools (create_task, edit_task, delete_task, move_task, message_task)
  - [ ] 2.5.3 Register LSP tools (lsp goToDefinition, findReferences, etc.)

## 3. Engine Registration

- [ ] 3.1 Add `CursorEngine` import to `src/bun/index.ts`
- [ ] 3.2 Add factory entry in `engineFactories` for "cursor"
- [ ] 3.3 Add cursor engine to `buildEngineInstances()` call
- [ ] 3.4 Add cursor to `coreFallbacks` array (like copilot, claude)

## 4. Testing

- [ ] 4.1 Create `src/bun/test/support/cursor-sdk-mock.ts` with mock SDK adapter
- [ ] 4.2 Create `src/bun/test/cursor-sdk-adapter.test.ts` with adapter unit tests
- [ ] 4.3 Create `src/bun/test/cursor-rpc-scenarios.test.ts` with shared RPC scenarios
  - [ ] 4.3.1 Single-turn chat scenario
  - [ ] 4.3.2 Multi-turn chat scenario
  - [ ] 4.3.3 Tool success scenario
  - [ ] 4.3.4 Tool failure scenario
  - [ ] 4.3.5 ask_user suspension scenario
  - [ ] 4.3.6 Cancellation scenario
  - [ ] 4.3.7 Fatal failure scenario
  - [ ] 4.3.8 Model listing scenario
