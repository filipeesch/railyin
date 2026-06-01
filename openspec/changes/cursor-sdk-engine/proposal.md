## Why

The Railyin codebase currently supports Copilot, Claude, OpenCode, and Pi engines, but lacks integration with the Cursor SDK. Cursor has launched an official SDK (`@cursor/sdk`) that provides a platform for AI agents with built-in tool capabilities (file operations, code editing, shell commands, etc.). Adding Cursor SDK support enables users to leverage Cursor's agent infrastructure directly from Railyin.

## What Changes

New engine type `cursor` that uses the `@cursor/sdk` package to execute agent runs:

- **New Engine Type**: Add `CursorEngine` to `src/bun/engine/cursor/` directory
- **Config Support**: Add `CursorEngineConfig` to `src/bun/config/index.ts` with `type: "cursor"` and optional `model` field
- **Engine Registration**: Add factory entry in `src/bun/index.ts`
- **Configuration File**: Update `config/engines.yaml.sample` with Cursor example

No breaking changes - purely additive functionality.

## Capabilities

### New Capabilities
- `cursor-sdk`: Integration with Cursor SDK for agent execution, supporting:
  - Agent creation and resumption via platform API
  - Direct streaming from `Run.stream()` for real-time token streaming
  - Built-in tools (read_file, write_file, edit, glob, grep, shell, task, etc.)
  - Common task tools (tasks_read, tasks_write) via MCP servers
  - Session persistence across Railyin restarts

### Modified Capabilities
None - no existing requirements are changing.

## Impact

**New Files Created:**
- `src/bun/engine/cursor/adapter.ts` - Cursor SDK adapter with `CursorSdkAdapter`
- `src/bun/engine/cursor/engine.ts` - `CursorEngine` implementing `ExecutionEngine`
- `src/bun/engine/cursor/events.ts` - Event translation (SDKMessage → EngineEvent)
- `src/bun/engine/cursor/tools.ts` - Common tool registration wrapper
- `src/bun/config/index.ts` - Add `CursorEngineConfig` interface
- `config/engines.yaml.sample` - Add cursor engine example

**Dependencies Added:**
- `@cursor/sdk@^1.0.0` (already installed in project)

**Platform Requirements:**
- Cursor CLI or Cursor SDK runtime must be available via `node_modules/@cursor/sdk`

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
