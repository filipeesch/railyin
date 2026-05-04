## Context

Railyin supports two AI execution engines: Claude (via `@anthropic-ai/claude-code-sdk`, subprocess + stdio) and Copilot (via `@github/copilot-sdk`, subprocess + SSE). Both run as short-lived processes spawned per workspace. OpenCode (`@opencode-ai/sdk`) is architecturally different: it is a persistent HTTP + SSE daemon that routes all directories through a single server process using a `?directory=` query parameter. Adding it as a third engine type requires a new server lifecycle model while preserving the existing `ExecutionEngine` interface contract consumed by the orchestrator.

The user goal is local LLM support (Ollama, LM Studio, any OpenAI-compatible endpoint) alongside cloud providers — something neither Claude nor Copilot engines currently support.

## Goals / Non-Goals

**Goals:**
- Implement `OpenCodeEngine` conforming to `ExecutionEngine` with full lifecycle: execute, resume, cancel, compact, listModels, listCommands, shutdown
- One OpenCode server process per Railyin instance (not per workspace) — route by `?directory=`
- Session continuity: one OpenCode session per `conversationId`, resumed across executions
- Tool injection via MCP (dynamic `POST /mcp` registration at server startup)
- Full multi-provider config: named provider map in `workspace.yaml` supporting Anthropic, OpenAI, OpenAI-compatible, and custom npm-backed providers (local LLMs)
- Attachment support: map Railyin `Attachment[]` → OpenCode `FilePartInput[]`
- Skills as commands: `GET /skill` → `CommandInfo[]`

**Non-Goals:**
- Migrating existing Claude/Copilot workspaces to OpenCode
- Supporting OpenCode's TUI or interactive terminal mode
- Exposing OpenCode's worktree management (`/experimental/worktree`) via Railyin
- UI changes — no new settings panels for this change

## Decisions

### D1: One server process per Railyin instance, not per workspace

**Decision**: A single `createOpencodeServer()` call on first use; all workspaces share it via `?directory=` routing.

**Rationale**: OpenCode's API is designed for this — every endpoint accepts `directory` and `workspace` query params. Sessions carry a `directory` field. `EventServerInstanceDisposed` fires per-directory, not globally. Running one server per workspace would waste resources and contradict the SDK's intent.

**Alternative considered**: Per-workspace servers (like Claude/Copilot). Rejected — OpenCode doesn't benefit from isolation this way, and it would require complex port management.

### D2: Session lifecycle keyed by `conversationId`

**Decision**: `Map<conversationId, openCodeSessionId>`. On `execute()`, check map — create session if absent, resume if present. On `compact()`, use the mapped session. Sessions are NOT deleted on execution end; they persist for the conversation lifetime.

**Rationale**: Matches how `ClaudeEngine` handles sessions (`claudeSessionIdForConversation`). OpenCode sessions are persistent and accumulate history, which is the desired UX for multi-turn chat.

**Alternative considered**: New session per execution (like Copilot). Rejected — loses conversation continuity.

**Session cleanup**: Sessions are removed from the map when `conversationId` is no longer active (explicit `shutdown()` on engine teardown clears all). No per-execution cleanup needed.

### D3: Tool injection via MCP (not native tool registration)

**Decision**: On server startup, register a Railyin-controlled MCP HTTP server via `POST /mcp`. The MCP server dispatches to execution context looked up by `conversationId`.

**Rationale**: OpenCode has no external tool registration endpoint. `/experimental/tool/ids` and `/experimental/tool` are read-only. MCP dynamic registration (`POST /mcp`) is the intended extension point. This mirrors how `ClaudeEngine` injects common tools (also via MCP).

**Context wiring**: Before each prompt, register `contextMap.set(conversationId, { taskId, boardId, callbacks })`. The system prompt includes `conversationId` so the MCP server can resolve the right context. Cleanup: `contextMap.delete(conversationId)` after execution ends.

**Alternative considered**: Per-execution MCP server on a random port. Rejected — complex port lifecycle, unclear if OpenCode reflects `POST /mcp` changes between prompt and first tool call.

### D4: Provider config as a named map in `workspace.yaml`

**Decision**: `engine.providers` is a `{ [id: string]: { api_key?, base_url?, npm?, models? } }` map injected verbatim into `Config.provider` at `createOpencodeServer()` time.

**Rationale**: OpenCode's `Config.provider` is already a `{ [id: string]: ProviderConfig }` map. Mapping our YAML 1:1 avoids transformation logic. Credentials are never written to disk (no `~/.local/share/opencode/auth.json` involvement).

**Local LLM support**: Set `npm: "@ai-sdk/openai-compatible"` and `base_url: http://localhost:11434/v1` for Ollama. Any npm-packaged AI SDK provider works the same way.

```yaml
engine:
  type: opencode
  model: anthropic/claude-sonnet-4-5  # default, format: providerID/modelID
  providers:
    anthropic:
      api_key: sk-ant-xxx
    my-ollama:
      npm: "@ai-sdk/openai-compatible"
      base_url: http://localhost:11434/v1
      models:
        qwen3:
          name: "Qwen 3 Coder"
```

### D5: `LeaseRegistry` and `EngineLeaseMetadata.engine` widened to `string`

**Decision**: Widen `engine: "copilot" | "claude"` literal union fields in `EngineLeaseMetadata` and `LeaseRegistry` constructor to `string`.

**Rationale**: The `"opencode"` engine needs a `LeaseRegistry` instance for server lifecycle tracking. The literal union was an accidental constraint — the registry logic doesn't depend on specific values.

### D6: No `taskLspRegistry` for OpenCode engine

**Decision**: Do not call `taskLspRegistry.getManager()` in `OpenCodeEngine.execute()`.

**Rationale**: OpenCode has built-in LSP support configured via `Config.lsp`. Double-registering would cause port conflicts and redundant processes. OpenCode's LSP is transparent to Railyin.

### D7: `listCommands()` maps OpenCode skills via `GET /skill`

**Decision**: Call `client.skills()` and map `{ name, description }` to `CommandInfo[]`.

**Rationale**: OpenCode exposes a `/skill` endpoint that returns `Array<{ name, description, location, content }>`. This is a clean, first-class API — no frontmatter parsing needed.

## Component Layout

```
src/bun/engine/opencode/
  ├── types.ts              OpenCodeEngineConfig, OpenCodeSdkAdapter interface,
  │                         OpenCodeExecutionContext, OpenCodeSession interface
  ├── adapter.ts            DefaultOpenCodeSdkAdapter — singleton server manager
  │                         server lifecycle, contextMap, sessionMap, MCP registration
  ├── event-translator.ts   Pure functions: SSE Part events → EngineEvent
  ├── attachment-mapper.ts  Railyin Attachment[] → FilePartInput[]
  ├── engine.ts             OpenCodeEngine implements ExecutionEngine
  └── index.ts              createDefaultOpenCodeSdkAdapter() factory
```

**Files modified:**
- `src/bun/engine/types.ts` — widen two literal union fields
- `src/bun/engine/resolver.ts` — add `"opencode"` case
- `src/bun/config/index.ts` — add `OpenCodeEngineConfig` to union + validation

## Event Translation Map

| OpenCode SSE Event | Railyin `EngineEvent` |
|---|---|
| `EventMessagePartUpdated` → `TextPart` | `{ type: "token", content }` |
| `EventMessagePartUpdated` → `ReasoningPart` | `{ type: "reasoning", content }` |
| `EventMessagePartUpdated` → `ToolPart` (state: running) | `{ type: "tool_start", name, arguments }` |
| `EventMessagePartUpdated` → `ToolPart` (state: completed) | `{ type: "tool_result", name, result }` |
| `EventMessagePartUpdated` → `ToolPart` (state: error) | `{ type: "tool_result", name, result, isError: true }` |
| `EventPermissionUpdated` | `{ type: "shell_approval", command, executionId }` |
| `EventSessionIdle` | `{ type: "done" }` |
| `EventSessionStatus { type: "retry" }` | `{ type: "status", message }` |
| `EventMessageUpdated` (tokens field) | `{ type: "usage", inputTokens, outputTokens }` |
| Server/client error | `{ type: "error", message, fatal: true }` |

## Risks / Trade-offs

**[Risk] OpenCode server binary not installed** → Mitigation: Emit a clear `{ type: "error", fatal: true }` with instructions (`npm install -g opencode-ai` or use `@opencode-ai/sdk` v2's `createOpencodeServer()` which bundles the binary). Surface the error in the engine status stream.

**[Risk] Single server process is a SPOF** → Mitigation: `LeaseRegistry` with `"opencode"` key tracks server health. On crash, re-create server on next `execute()` call. All session mappings are in-memory, so sessions are re-created automatically (conversation history preserved in OpenCode's own storage).

**[Risk] MCP context map grows unbounded** → Mitigation: `contextMap.delete(conversationId)` is called in the `finally` block of every execution. Map entries are short-lived (scoped to one execution at a time per conversation).

**[Risk] `POST /mcp` registration races with first prompt** → Mitigation: MCP server is registered once during `adapter` initialization (before any `execute()` call), not per-execution. Server startup completes before the engine is returned from the resolver.

**[Risk] Per-provider credential exposure in logs** → Mitigation: `api_key` values are read from `workspace.yaml` and injected into `createOpencodeServer({ config })` in-process. They are never logged. `onRawModelMessage` handlers should redact `options.apiKey` before persisting.

## Migration Plan

1. Install `@opencode-ai/sdk` (or confirm it's already in `package.json`)
2. Implement `src/bun/engine/opencode/` components
3. Wire into `resolver.ts` and `config/index.ts`
4. Users opt-in by changing `engine.type: opencode` in `workspace.yaml`
5. No data migration needed — conversations are engine-agnostic at the DB level
6. Rollback: revert `engine.type` to previous value; no schema changes

## Open Questions

- Does `@opencode-ai/sdk` v2's `createOpencodeServer()` bundle the `opencode` binary, or must it be separately installed? Needs verification before implementation.
- Can `PATCH /config` inject provider credentials at runtime (vs. startup-only)? Relevant if providers need to be hot-reloaded without restarting the server.
