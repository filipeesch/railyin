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

### 2. Session Management: Resume Cursor Agent per Conversation (Caller-Defined Id)

**Decision:** Compute a deterministic Cursor `agentId` as a UUIDv5 derived from a fixed Railyin namespace and a per-conversation name (`task:${taskId}` when task-scoped, `conversation:${conversationId}` otherwise), and pass it on every run. The worker tries `Agent.resume(agentId, { apiKey, model, local: { cwd, customTools } })` first and falls back to `Agent.create({ agentId, ...baseOptions })` with the same id on resume failure (typically the first turn). The agent is closed at the end of each turn; the next turn resumes the same id so the SDK keeps the chat history. `CursorEngine.resume()` (the executor-level resume entry point used by `HumanTurnExecutor`) still throws — there is no in-turn resume of an *aborted* run; that path remains a fresh-execution restart.

**Storage:** None. The id is derived; no Railyin table is needed.

**Rationale:**
- The earlier "fresh Agent.create per turn" design dropped all SDK-side conversation history. The orchestrator passes only the latest user message as the `prompt` (chat-executor.ts:126), expecting the engine to hold history. Cursor's SDK does hold it — per `SDKAgent` — but only when the same `agentId` is resumed across turns.
- `AgentOptions.agentId` is honored by the SDK: in `Agent.create`, the SDK uses the caller-supplied id verbatim and only auto-generates one when omitted (verified in `@cursor/sdk/dist/esm/index.js` — `e.agentId ?? generated_id`). The local agent store keys by this id, so passing the same id on subsequent calls resumes the prior conversation state.
- A computed UUID mirrors the Copilot engine's `copilotSessionIdForConversation(taskId, conversationId)` pattern (`engine/copilot/session.ts`) and removes the engine-specific DB column entirely. UUIDv5 (vs. a human-readable `railyin-*` slug) keeps the value opaque to the SDK's local store and avoids leaking Railyin-internal naming into Cursor's id space.
- Repeated `Agent.create()` calls within the same worker process also leaked abort listeners on internal SDK signals (`MaxListenersExceededWarning: 11 abort listeners added to [AbortSignal]`). Resuming a single agent per conversation eliminates the listener accumulation as a side effect.
- The Cursor SDK has no in-turn resume primitive for suspend-loop tools (`decision_request` / `ask_user` still terminate the run). Those continue to be handled by `HumanTurnExecutor`'s fresh-execution restart branch; the new behavior only restores cross-turn continuity, not mid-turn resume.
- `sessionId = cursor-${conversationId}` remains the persistence key for raw-message logging; it is independent of the SDK `agentId`.

**Trade-offs:**
- One failed `Agent.resume` round-trip on every first turn before falling through to `Agent.create`. Negligible vs. model latency.
- No room for engine-managed id rotation — the deterministic id is the contract.
- If Cursor cloud agents are added later, they auto-issue `bc-` prefixed ids and reject caller-supplied ones; this scheme would need to revert to persisted ids at that point. Currently moot — local agents only.

### 3. Event Streaming: Direct from Run.stream()

**Decision:** Use `Run.stream()` to get SDKMessage events directly, then translate each to EngineEvent types.

**Rationale:**
- SDK provides structured SDKMessage types (assistant, user, tool_call, thinking, status)
- Direct mapping to EngineEvent is simpler than delta-based approach
- Aligns with Copilot and Claude patterns
- No need for custom delta event handling (Cursor SDK handles this internally)

### 4. Tool Support: Built-in Tools + Common Tools as customTools (+ Bypass Tools)

**Decision:** Cursor's built-in tools (Read/Edit/etc.) remain available — the SDK does not expose a knob to disable them. Railyin's common task tools (`COMMON_TOOL_DEFINITIONS`) and MCP-registry tools are registered as `SDKCustomTool` entries via `LocalAgentOptions.customTools`. Additionally, `tools.ts` exposes Railyin-native equivalents (`railyin_shell`, `railyin_grep`, `railyin_glob`, `railyin_read`) and a system-prompt prefix steering the agent to prefer them.

**Rationale:**
- The Cursor SDK has no MCP-server config slot in the local-agent path; `customTools` is the only injection point for Railyin tools.
- Suspend-loop tools (e.g. `decision_request`) need to terminate the run. The custom-tool wrapper invokes `executeCommonTool`, and on `result.type === "suspend"` it calls the engine's `onSuspend` callback, which aborts the run and surfaces a `decision_request` event upstream.
- The bypass tools exist because the SDK 1.0.18 built-in `Shell` / `Grep` / `Glob` fail on non-trivial workloads (the same transport limit that motivated Decision 6, but on the SDK's *own* server replies — not something the subprocess fixes). Steering the agent to `railyin_*` keeps tool execution reliable.

### 5. Config Structure: API key in engines.yaml

**Decision:** `CursorEngineConfig` includes optional `api_key?: string` (read by the adapter via `CursorAdapterOptions.apiKey`). Falls back to `process.env.CURSOR_API_KEY` when omitted.

**Rationale:**
- The Cursor SDK's `Agent.create({ apiKey })` requires an API key explicitly — there is no CLI-style ambient auth for SDK consumers
- Co-locating the key in `engines.yaml` matches how other engines configure secrets in this codebase
- Env-var fallback keeps deployments that already provision `CURSOR_API_KEY` working

### 6. Subprocess Isolation for Transport (Bun workaround)

**Decision:** Run `@cursor/sdk` in a long-lived Node.js subprocess (`src/bun/engine/cursor/worker.mjs`, hosted by `worker-client.ts`). The Bun parent communicates with it over line-delimited JSON on stdio (wire types in `worker-protocol.ts`). Tool callbacks remain on the Bun side and are proxied back over the same channel; the public `CursorSdkAdapter` interface is unchanged so `engine.ts` is agnostic to the transport.

**Rationale:**
- The Cursor SDK uses HTTP/2 via `@connectrpc/connect-node`. Bun's HTTP/2 client has a runtime bug: `session.settings({ maxFrameSize })` updates the JS-visible `localSettings` property and the server ACKs the new value, but nghttp2's internal `max_frame_size` used for *inbound* frame validation stays at the 16 KB default. Cursor's backend streams DATA frames larger than 16 KB during any meaningful agent run, which Bun rejects with `NGHTTP2_FRAME_SIZE_ERROR` before the SDK can complete a single response.
- The bug is in Bun's nghttp2 binding, not reachable from JavaScript — verified empirically with extensive logging (every patch attempt, including pre-connect SETTINGS gating and waiting for the `localSettings` ACK event, still fails because nghttp2 keeps the old internal limit).
- Node's `http2` honors `session.settings()` correctly, so the subprocess solves the transport problem without rewriting the SDK or its dependencies.
- A single long-lived worker (not one per run) keeps startup cost amortised: ~150-300 ms at boot, ~1-3 ms per IPC message, both negligible relative to model latency.

**Trade-offs:**
- Extra ~50-80 MB resident from the Node process while the Cursor engine is in use
- An additional binary requirement (`node` on PATH, or `RAILYIN_CURSOR_NODE` env override)
- Tool callbacks are now async-over-IPC instead of in-process — adds one round-trip but still completes well inside model-call latency budgets

## Risks / Trade-offs

### Risk: SDK is New and May Change

**Mitigation:**
- Version-pinned `@cursor/sdk@1.0.18`
- Adapter surface (`CursorSdkAdapter`) is narrow — only `run`, `cancel`, `listModels`, `listCommands`, `shutdownAll` — so SDK changes are absorbed inside the worker

### Risk: Bun HTTP/2 incompatibility (the bug above)

**Mitigation:** Decision 6 — run the SDK out-of-process under Node. If Bun later fixes the nghttp2 binding, the subprocess can be reverted to an in-process adapter without changing `engine.ts` or `tools.ts`.

### Risk: Subprocess crash mid-run

**Mitigation:**
- Worker exit triggers `pushError` on every active run, which propagates as a fatal `EngineEvent` upstream
- Pending tool-call promises are rejected so they don't dangle
- Next call to the adapter respawns the worker

### Risk: Missing Node binary

**Mitigation:**
- Default to `node` on PATH; override via `RAILYIN_CURSOR_NODE`
- If `node` is missing, the spawn fails with a clear error surfaced as `EngineEvent.error` rather than a silent hang

### Risk: Missing Cursor platform binaries (ripgrep)

**Mitigation:**
- NPM package ships platform binaries as optional dependencies; installed automatically via `bun install`
- `cursor/tools.ts:findBundledRipgrep()` falls back to `rg` on PATH if the bundled binary is unavailable
