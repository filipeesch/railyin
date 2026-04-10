## 1. Types and Interface Foundation

- [x] 1.1 Create `src/bun/engine/types.ts` with `ExecutionEngine`, `EngineEvent`, `ExecutionParams`, `EngineModelInfo`, and `CommonToolContext` types
- [x] 1.2 Create `src/bun/engine/common-tools.ts` — extract `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_task`, `list_tasks`, `get_board_summary` handlers and metadata from `src/bun/workflow/tools.ts`

## 2. Config Restructuring

- [x] 2.1 Update `WorkspaceYaml` type to support `engine:` block with `type` discriminator (native config with providers/default_model/anthropic/search/lsp, copilot config with model)
- [x] 2.2 Implement auto-migration in config loader: detect legacy top-level `providers:`, `default_model:`, `ai:`, `anthropic:`, `search:`, `lsp:` and wrap under `engine: { type: native, ... }` in memory
- [x] 2.3 Update `workspace.yaml.sample` and `workspace.test.yaml` to use new `engine:` block format
- [x] 2.4 Update all `getConfig()` consumers to read from `config.engine.*` instead of top-level fields

## 3. Native Engine Extraction

- [x] 3.1 Create `src/bun/engine/native/engine.ts` — `NativeEngine` class implementing `ExecutionEngine` interface
- [x] 3.2 Create `src/bun/engine/native/loop.ts` — extract agentic loop from `src/bun/workflow/engine.ts` (`runExecution`) to yield `EngineEvent` via AsyncIterable
- [x] 3.3 Create `src/bun/engine/native/tools.ts` — move all non-common tool definitions and `executeTool()` from `src/bun/workflow/tools.ts`
- [x] 3.4 Create `src/bun/engine/native/context.ts` — extract `assembleMessages()`, context estimation, worktree context building
- [x] 3.5 Create `src/bun/engine/native/compaction.ts` — extract `compactConversation()`, micro-compact logic
- [x] 3.6 Create `src/bun/engine/native/session-memory.ts` — move session memory extraction (internal, no RPC surface)
- [x] 3.7 Create `src/bun/engine/native/sub-agent.ts` — extract `runSubExecution()` / spawn_agent logic
- [x] 3.8 Implement `NativeEngine.listModels()` — delegate to provider registry's `/v1/models` calls
- [x] 3.9 Implement `NativeEngine.cancel()` — abort in-flight AI HTTP request via AbortSignal
- [x] 3.10 Verify native engine extraction: all existing behavior preserved, no regressions

## 4. Engine Resolver

- [x] 4.1 Create `src/bun/engine/resolver.ts` — `resolveEngine(config)` reads `engine.type` and returns the correct `ExecutionEngine` instance
- [x] 4.2 Wire resolver into app startup — instantiate engine once and make available to orchestrator

## 5. Orchestrator

- [x] 5.1 Create `src/bun/engine/orchestrator.ts` — `executeTransition()`, `executeHumanTurn()`, `executeRetry()`, `executeCodeReview()`, `cancel()`
- [x] 5.2 Implement event stream consumer: persist tool_call/tool_result messages, accumulate tokens → assistant message, relay tokens to UI via RPC
- [x] 5.3 Implement AbortController lifecycle management (register at start, remove on end)
- [x] 5.4 Implement slash reference resolution in orchestrator (move from engine.ts)
- [x] 5.5 Implement state machine: execution_state transitions (running → completed/failed/waiting_user/cancelled)
- [x] 5.6 Implement usage tracking: consume `usage` EngineEvents and update execution records

## 6. Update RPC Handlers

- [x] 6.1 Update `src/bun/handlers/tasks.ts` — replace direct `engine.ts` calls with orchestrator dispatch
- [x] 6.2 Update `models.list` / `models.listEnabled` RPC to delegate to `engine.listModels()`
- [x] 6.3 Remove session memory RPC surface (keep internal native engine implementation)
- [x] 6.4 Update `tasks.cancel` handler to route through `orchestrator.cancel()`

## 7. Copilot Engine

- [x] 7.1 Add `@github/copilot-sdk` dependency to `package.json`
- [x] 7.2 Create `src/bun/engine/copilot/engine.ts` — `CopilotEngine` implementing `ExecutionEngine`
- [x] 7.3 Create `src/bun/engine/copilot/session.ts` — CopilotClient lifecycle (start/stop/session creation)
- [x] 7.4 Create `src/bun/engine/copilot/events.ts` — translate SDK events (`assistant.message_delta`, `tool.execution_start`, etc.) to `EngineEvent`
- [x] 7.5 Create `src/bun/engine/copilot/tools.ts` — wrap common-tools as `defineTool()` with Zod schemas
- [ ] 7.6 Implement system message customization: pass `stage_instructions` via `systemMessage: { mode: "customize" }`
- [ ] 7.7 Implement `onPermissionRequest` → `shell_approval` EngineEvent translation
- [ ] 7.8 Implement `onUserInputRequest` → `ask_user` EngineEvent translation
- [x] 7.9 Implement `CopilotEngine.listModels()` — return available Copilot models
- [x] 7.10 Implement `CopilotEngine.cancel()` — disconnect active session
- [ ] 7.11 Validate Bun compatibility with Copilot SDK (subprocess spawn, JSON-RPC)

## 8. Cleanup and Integration

- [ ] 8.1 Remove old `src/bun/workflow/engine.ts` — all logic now in `src/bun/engine/` tree *(blocked by 3.2 extraction)*
- [ ] 8.2 Remove old `src/bun/workflow/tools.ts` — split into `common-tools.ts` + `native/tools.ts` *(blocked by 3.3 extraction)*
- [x] 8.3 Update imports across codebase to reference new `src/bun/engine/` paths (native/orchestrator wiring complete)
- [x] 8.4 Update workflow YAML samples if any tool group names changed

## 9. Validation

- [x] 9.1 End-to-end test: native engine — task transition, human turn, retry, cancel, code review
- [ ] 9.2 End-to-end test: copilot engine — task transition with Copilot running execution, custom tool call, cancel
- [x] 9.3 Test config migration: legacy workspace.yaml auto-migrates to engine.type: native
- [x] 9.4 Test model listing from both engines
- [x] 9.5 Test error scenarios: missing auth for Copilot, unknown engine type, provider failures
