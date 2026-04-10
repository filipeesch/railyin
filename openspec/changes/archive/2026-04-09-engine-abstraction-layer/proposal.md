## Why

Railyin's agentic execution is tightly coupled to its own workflow engine — it owns the full loop: LLM inference, tool selection, tool execution, compaction, and context management. Users who have a GitHub Copilot subscription (or in the future, a Claude Pro/Max subscription) cannot leverage those platforms as execution engines. This change introduces an engine abstraction layer so users can choose their execution engine per workspace — keeping Railyin's board/task/review value while delegating the agentic coding work to the platform they trust and pay for.

## What Changes

- **New `ExecutionEngine` interface**: A common contract that all engines implement — `execute()`, `cancel()`, `sendMessage()`, model listing, returning a unified event stream.
- **Engine-based workspace config**: The `workspace.yaml` `engine:` block replaces the current top-level `providers:` / `ai:` / `anthropic:` / `search:` / `lsp:` fields. A single `engine.type` discriminates the config schema. Current config becomes `engine.type: native`.
- **Native engine extraction**: Current `engine.ts`, `tools.ts`, compaction, sub-agents, session memory, and provider layer are moved into `src/bun/engine/native/` — implementing the new interface with zero behavior change.
- **Copilot engine (new)**: A new engine wrapping `@github/copilot-sdk` (Node.js). Copilot handles the agentic loop, built-in tools (file ops, shell, git, search), compaction ("infinite sessions"), and model inference. Railyin registers task management tools as custom tools and relays SDK events to the UI.
- **Common tools extraction**: Board/task management tools (`create_task`, `move_task`, `list_tasks`, etc.) are extracted into a shared module. These are the only tools registered across all engines.
- **Session memory removed from UI**: Session memory becomes a native-engine-internal optimization with no RPC surface.
- **Config migration**: Existing `workspace.yaml` files auto-migrate to `engine.type: native` format on load.

## Capabilities

### New Capabilities
- `execution-engine`: The `ExecutionEngine` interface, engine event types, engine resolution from config, and the orchestrator that delegates to the active engine.
- `copilot-engine`: Copilot SDK integration — session management, event translation, permission handling, and custom tool registration.
- `engine-common-tools`: Shared task/board management tool handlers that work across any engine.

### Modified Capabilities
- `workflow-engine`: The orchestrator now delegates to `ExecutionEngine.execute()` instead of directly running the agentic loop. `handleTransition`, `handleHumanTurn`, `handleRetry`, `handleCodeReview` become engine-agnostic dispatchers.
- `multi-provider-config`: Provider config moves under `engine.type: native` sub-block. The `engine:` top-level key replaces the current `providers:` / `default_model:` / `anthropic:` / `search:` / `lsp:` keys.
- `model-selection`: Model listing and selection becomes engine-aware. Each engine exposes `listModels()`. The UI continues to show model picker; the source of models depends on the active engine.
- `task`: Tasks gain awareness of which engine executed them (for conversation format differences).
- `cancel-execution`: Cancellation routes through the engine abstraction (`engine.cancel(executionId)`).

## Impact

- **Code**: Major refactor of `src/bun/workflow/engine.ts` and `src/bun/workflow/tools.ts` — split into `src/bun/engine/` directory tree. Handler files (`tasks.ts`, `conversations.ts`) updated to use engine abstraction.
- **Config**: `workspace.yaml` schema changes (backward-compatible via auto-migration). `workspace.yaml.sample` updated.
- **Dependencies**: New dependency on `@github/copilot-sdk` (npm). Bun compatibility needs validation (SDK spawns Copilot CLI subprocess via JSON-RPC).
- **UI**: Minor — session memory RPC removed. Model picker source changes. No new UI components needed.
- **Database**: No schema changes. Conversation messages table continues to store all message types regardless of engine.
