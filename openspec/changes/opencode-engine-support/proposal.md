## Why

Railyin currently supports Claude and Copilot as execution engines, both of which depend on vendor-managed AI routing. Adding OpenCode SDK engine support enables users to run local LLMs (Ollama, LM Studio) and any OpenAI-compatible provider through a single, self-hosted AI coding agent — reducing cloud dependency and unlocking fully offline workflows.

## What Changes

- Add `engine.type: opencode` as a new supported engine type in `workspace.yaml`
- Add `OpenCodeEngineConfig` with a `providers` map supporting Anthropic, OpenAI, OpenAI-compatible endpoints, and custom npm-based AI SDK providers (for local LLMs)
- Implement `OpenCodeEngine` conforming to the `ExecutionEngine` interface, backed by a single shared `@opencode-ai/sdk` server process per Railyin instance
- Map Railyin `conversationId` → OpenCode session lifecycle (create once, resume across executions)
- Expose Railyin's task-management tools (task transitions, human-turn, etc.) to OpenCode via MCP registration at server startup
- Translate OpenCode SSE events (`TextPart`, `ToolPart`, `ReasoningPart`, `EventSessionIdle`, etc.) to typed `EngineEvent` values
- Map Railyin file attachments to OpenCode `FilePartInput` for multimodal support
- Surface OpenCode skills as Railyin slash commands via `listCommands()`
- Widen `RawModelMessage.engine` and `EngineLeaseMetadata.engine` from a closed literal union to `string` to accommodate the new engine type without breaking existing code
- Add `"opencode"` branch to `resolver.ts` and `EngineConfig` union in `config/index.ts`

## Capabilities

### New Capabilities

- `opencode-engine`: Full lifecycle implementation of the OpenCode execution engine — server management, session mapping, event translation, tool injection via MCP, attachment mapping, model listing, skills-as-commands, compaction, and graceful shutdown

### Modified Capabilities

- `execution-engine`: Widen `RawModelMessage.engine` and `EngineLeaseMetadata.engine` types from `"claude" | "copilot"` closed union to `string` to support extensible engine identification without breaking existing consumers

## Impact

- **New dependency**: `@opencode-ai/sdk` (already available on npm, MIT license)
- **`src/bun/engine/`**: New `opencode/` directory with `types.ts`, `adapter.ts`, `event-translator.ts`, `attachment-mapper.ts`, `engine.ts`, `index.ts`
- **`src/bun/engine/types.ts`**: Widen two literal union fields
- **`src/bun/engine/resolver.ts`**: Add `"opencode"` case
- **`src/bun/config/index.ts`**: Add `OpenCodeEngineConfig` to the `EngineConfig` union and validation branch
- **No breaking changes** to existing Claude or Copilot engine behaviour
- **No new API endpoints** — existing orchestrator and RPC contract unchanged
- **Runtime**: One additional long-lived process (OpenCode server) when any workspace uses `engine.type: opencode`
