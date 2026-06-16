## Why

The Railyin codebase currently supports Copilot, Claude, OpenCode, and Pi engines, but lacks integration with the Cursor SDK. Cursor has launched an official SDK (`@cursor/sdk`) that provides a platform for AI agents with built-in tool capabilities (file operations, code editing, shell commands, etc.). Adding Cursor SDK support enables users to leverage Cursor's agent infrastructure directly from Railyin.

## What Changes

New engine type `cursor` that uses the `@cursor/sdk` package to execute agent runs:

- **New Engine Type**: Add `CursorEngine` to `src/bun/engine/cursor/` directory
- **Subprocess Isolation**: SDK runs in a Node.js subprocess (`src/bun/engine/cursor/worker.mjs`, hosted by `worker-client.ts`) to work around a Bun HTTP/2 bug that rejects Cursor's streaming frames (see `design.md` Decision 6). The Bun parent talks to the worker over line-delimited JSON on stdio
- **Config Support**: Add `CursorEngineConfig` to `src/bun/config/index.ts` with `type: "cursor"` and optional `api_key` and `model` fields
- **Engine Registration**: Add factory entry in `src/bun/index.ts`
- **Configuration File**: Update `config/engines.yaml.sample` with Cursor example

No breaking changes - purely additive functionality.

## Capabilities

### New Capabilities
- `cursor-sdk`: Integration with Cursor SDK for agent execution, supporting:
  - **Per-conversation agent resume.** The engine derives a deterministic Cursor `agentId` from `(taskId, conversationId)` and passes it on every run. The worker calls `Agent.resume(agentId, ...)` first, falling back to `Agent.create({ agentId, apiKey, model, local: { cwd, customTools } })` with the same id on the first turn (or after a resume failure). This preserves Cursor's chat history across turns without any Railyin-side persistence. `CursorEngine.resume()` (the in-turn resume entry point used by `HumanTurnExecutor`) still throws, so suspend-loop tools restart a fresh execution as before
  - Direct streaming from `Run.stream()` for real-time token streaming
  - Cursor's built-in tools remain available (no SDK knob to disable)
  - Railyin's common task tools (`COMMON_TOOL_DEFINITIONS`) and MCP-registry tools registered as `SDKCustomTool` entries via `LocalAgentOptions.customTools`
  - Railyin-native bypass tools (`railyin_shell`, `railyin_grep`, `railyin_glob`, `railyin_read`) registered alongside, with the agent steered toward them via the composed prompt
  - SDK execution isolated in a Node.js subprocess; tool callbacks proxied back to Bun over stdio JSON-RPC

### Modified Capabilities
None - no existing requirements are changing.

## Impact

**New Files Created:**
- `src/bun/engine/cursor/adapter.ts` — `CursorSdkAdapter` interface + factory delegating to subprocess client
- `src/bun/engine/cursor/engine.ts` — `CursorEngine` implementing `ExecutionEngine`
- `src/bun/engine/cursor/events.ts` — Event translation (SDKMessage → EngineEvent), Bun side
- `src/bun/engine/cursor/tools.ts` — Common-tool + bypass-tool registration
- `src/bun/engine/cursor/worker-protocol.ts` — Bun↔Node IPC wire types
- `src/bun/engine/cursor/worker-client.ts` — `SubprocessCursorAdapter` (Bun side)
- `src/bun/engine/cursor/worker.mjs` — Node ESM worker that imports `@cursor/sdk` and proxies tool calls back over stdio (the only `.mjs` file in the codebase)

**Modified Files:**
- `src/bun/config/index.ts` — Add `CursorEngineConfig` interface
- `src/bun/index.ts` — Register cursor engine factory
- `config/engines.yaml.sample` — Add cursor engine example

**Dependencies Added:**
- `@cursor/sdk@1.0.18` (already installed in project)

**Platform Requirements:**
- `node` available on `PATH` (or `RAILYIN_CURSOR_NODE` env override) — used to host the SDK subprocess. The Bun parent does *not* import `@cursor/sdk` directly
- `@cursor/sdk` platform binaries installed via `bun install` (includes bundled ripgrep used by `railyin_grep`)

## Testing

**Test Strategy:**
The implementation includes comprehensive test coverage following existing patterns:

### Unit Tests (`src/bun/test/cursor/`)
- Mock SDK adapter using AsyncGenerator pattern for `Run.stream()`
- Tests for agent creation, resumption, and cancellation
- Event translation from SDKMessage to EngineEvent types

### Integration Tests (`src/bun/test/cursor/`)
- Reuses `shared-rpc-scenarios.ts` without modification
- Single-turn, multi-turn, tool success/failure scenarios
- ask_user suspension and cancellation scenarios

### Playwright Tests (`e2e/ui/cursor.spec.ts`)
- Engine selection in model picker
- Execution flow validation
- Tool rendering for Cursor-specific features

**Test Infrastructure:**
- No refactoring needed - existing `backend-rpc-runtime.ts` and `shared-rpc-scenarios.ts` work as-is
- Follows established patterns from Copilot, Claude, and Pi engines
- Tests organized by feature in `src/bun/test/cursor/` directory
