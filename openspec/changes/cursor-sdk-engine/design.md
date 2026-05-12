## Context

Railyin currently supports multiple AI engine types (Copilot, Claude, OpenCode, Pi) through the `ExecutionEngine` interface. Each engine wraps a specific SDK and translates its events to the shared `EngineEvent` stream format. The Cursor SDK (`@cursor/sdk`) is a new official SDK from Cursor that provides agent execution capabilities through gRPC/Connect protocol.

**Current State:**
- Railyin supports 4 engine types: copilot, claude, opencode, pi
- Each engine has: adapter, engine, events, tools modules
- Engine registration happen in `src/bun/index.ts` via `engineFactories` map
- engines.yaml sample includes all 4 engines

**Constraint:** Cursor SDK uses a different communication model than Copilot:
- Copilot: Uses CLI subprocess with STDIO
- Cursor: Uses gRPC/Connect via in-process SDK

**Dependencies:**
- `@cursor/sdk@1.0.12` is already installed as a dependency
- Platform binaries bundled via optional dependencies (`@cursor/sdk-darwin-arm64`, etc.)

## Goals / Non-Goals

**Goals:**
- Add Cursor SDK as a supported engine type in Railyin
- Support agent creation and resumption via platform API
- Enable streaming of tokens, reasoning, tool calls, and status updates
- Integrate with existing Railyin tool system (tasks_read, tasks_write, MCP tools)
- Support session persistence for task-based executions
- Follow existing engine patterns for consistency

**Non-Goals:**
- CLI process management (Cursor SDK handles this internally)
- Platform-specific installation or download logic
- UI changes to model selection or engine configuration
- Migration from existing Cursor integrations (none currently exist)

## Decisions

### 1. Implementation Pattern: Single Adapter (Follows Copilot/Claude)

**Decision:** Use a single `CursorSdkAdapter` class that wraps the Cursor SDK API, similar to `ClaudeSdkAdapter` and `CopilotSdkAdapter`.

**Rationale:**
- Consistent with existing engine patterns
- Centralizes SDK interactions (platform, agent, streaming)
- Easier to test with mocks
- Clear separation between adapter (SDK wrapper) and engine (event stream)

### 2. Session Management: Platform-based Persistent Agents

**Decision:** Use `createAgentPlatform()` and `Agent.create()` / `Agent.resume()` for agent lifecycle, with agent IDs based on `cursor-${conversationId}`.

**Rationale:**
- Cursor SDK provides durable agent storage via platform API
- Agent persistence survives Railyin restarts
- `cursor-${conversationId}` pattern matches existing `copilotSessionIdForConversation()` and `claudeSessionIdForConversation()` patterns
- Minimal config needed - cursor-cli needs to be installed by user

### 3. Event Streaming: Direct from Run.stream()

**Decision:** Use `Run.stream()` to get SDKMessage events directly, then translate each to EngineEvent types.

**Rationale:**
- SDK provides structured SDKMessage types (assistant, user, tool_call, thinking, status)
- Direct mapping to EngineEvent is simpler than delta-based approach
- Aligns with Copilot and Claude patterns
- No need for custom delta event handling (Cursor SDK handles this internally)

### 4. Tool Support: All Built-in Tools + Common Tools

**Decision:** Enable all Cursor built-in tools (read_file, write_file, edit, glob, grep, shell, task, etc.) plus common engine tools via MCP servers configuration.

**Rationale:**
- Full functionality matches Copilot/Claude behavior
- Common tools (tasks_read, tasks_write) via MCP servers option
- Users get the same capabilities as Copilot engine

### 5. Config Structure: Minimal

**Decision:** `CursorEngineConfig` only includes `model?: string`, no `apiKey` field.

**Rationale:**
- Cursor SDK handles auth via environment variables or Cursor CLI setup
- NPM package includes platform binaries
- User configures Cursor separately (via `cursor login` or env vars)
- Simpler than Copilot which has authentication via gh CLI

## Risks / Trade-offs

### Risk: SDK is New and May Change

**Mitigation:** 
- Use version-pinned `@cursor/sdk@1.0.12` (already installed)
- SDK is marked as `public` on npm, suggesting stability commitment
- Platform API (`createAgentPlatform`, `Agent.create`) provides stable abstraction

### Risk: gRPC/Connect vs STDIO Communication

**Mitigation:**
- Cursor SDK handles gRPC internally (not our problem to manage)
- We only use the SDK's JS API, not raw gRPC
- No process spawning or terminal management needed

### Risk: Platform Storage Location

**Mitigation:**
- Cursor SDK manages agent storage (in `~/.cursor/` or project-based)
- No need to specify custom paths - SDK handles it
- We use platform API with `cwd` option when needed

### Risk: Missing Cursor CLI / Platform Binaries

**Mitigation:**
- NPM package ships platform binaries as optional dependencies
- Should be installed automatically via `bun install`
- Error message will guide user to run `bun install` if missing
