## Context

Railyin is a desktop AI delivery orchestration app (Electrobun + Bun + Vue). Today it owns the entire agentic execution loop: message assembly, LLM streaming via provider abstraction (Anthropic, OpenAI-compatible), tool execution (30+ tools), compaction, sub-agents, and context management. All of this lives in `src/bun/workflow/engine.ts` (~500 lines core loop) and `src/bun/workflow/tools.ts` (~40 functions).

The GitHub Copilot SDK (`@github/copilot-sdk`, public preview, 8.3k stars) exposes the same engine behind Copilot CLI as a programmable SDK. It provides: agentic loop, built-in tools (file ops, shell, git, web), compaction ("infinite sessions"), streaming, custom tool registration, session hooks, and permission handling — all via JSON-RPC to a bundled CLI process.

Users want to use their Copilot subscription instead of managing API keys. This requires abstracting the "execution engine" concept so it's swappable per workspace.

## Goals / Non-Goals

**Goals:**
- Define an `ExecutionEngine` interface that both the native engine and Copilot engine implement
- Extract current engine code into `src/bun/engine/native/` with zero behavior change
- Implement `src/bun/engine/copilot/` wrapping `@github/copilot-sdk`
- Restructure `workspace.yaml` to use `engine:` block with `type` discriminator
- Auto-migrate existing configs to `engine.type: native`
- Keep all Railyin-owned features working regardless of engine: boards, tasks, workflow transitions, code review, git worktrees, conversation persistence, model selection
- Extract task management tools as shared/common tools across engines

**Non-Goals:**
- Claude Code engine (future work, same interface)
- Effort selection UI (use model defaults for now)
- Worktree management by external engines (Railyin always manages worktrees)
- Replacing the native engine — it remains the default and most feature-rich option
- Engine switching at runtime or per-task — one engine per workspace

## Decisions

### D1: Single `engine:` block in workspace.yaml (not `engines:`)

One engine per workspace. The `type` field discriminates the config schema.

```yaml
# Native
engine:
  type: native
  providers: [...]
  default_model: anthropic/claude-opus-4-1
  anthropic: { cache_ttl: 1h, enable_thinking: true }
  search: { engine: tavily, api_key: ... }
  lsp: { servers: [...] }

# Copilot
engine:
  type: copilot
  model: gpt-5
```

**Rationale:** Engine is an architectural choice, not a runtime toggle. Different engines have fundamentally different config shapes. A single `engine:` block is simpler than `engines:` with a selector. Users edit YAML to switch — no UI needed.

**Alternative considered:** `engines:` map with `active_engine:` key. Rejected — adds complexity for no value since we never need two engines simultaneously.

### D2: ExecutionEngine interface — event-stream based

```typescript
interface ExecutionEngine {
  execute(params: ExecutionParams): AsyncIterable<EngineEvent>;
  cancel(executionId: number): void;
  sendMessage(executionId: number, content: string): void;
  listModels(): Promise<EngineModelInfo[]>;
}

interface ExecutionParams {
  executionId: number;
  taskId: number;
  prompt: string;              // Resolved on_enter_prompt or user message
  systemInstructions?: string; // stage_instructions from column config
  workingDirectory: string;    // Worktree path (or project root)
  model: string;               // Engine-specific model ID
  signal: AbortSignal;
  conversationHistory?: ConversationMessage[];  // For native engine context rebuild
}
```

**Rationale:** `AsyncIterable<EngineEvent>` is the natural TypeScript pattern for streaming. The orchestrator consumes events and handles persistence/UI relay uniformly. Each engine yields events at its own pace.

**Alternative considered:** Callback-based (`onToken`, `onToolCall`, etc. — current pattern). Rejected — callbacks couple the engine to the consumer. AsyncIterable cleanly separates production from consumption.

### D3: EngineEvent types — translated per engine

```typescript
type EngineEvent =
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_start"; name: string; arguments: string }
  | { type: "tool_result"; name: string; result: string; isError?: boolean }
  | { type: "ask_user"; question: string; options?: AskUserOption[] }
  | { type: "shell_approval"; command: string; executionId: number }
  | { type: "status"; message: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; summary?: string }
  | { type: "error"; message: string; fatal?: boolean }
```

Each engine adapter translates native events into this format:
- **Native engine:** `StreamEvent` + tool execution events → `EngineEvent`
- **Copilot engine:** `assistant.message_delta`, `tool.execution_start`, `tool.execution_complete` → `EngineEvent`

**Rationale:** A common event type lets the orchestrator handle persistence and UI relay identically regardless of engine. Engines don't need to know about Railyin's DB schema or RPC protocol.

### D4: Orchestrator replaces direct engine.ts calls

The workflow orchestrator (`src/bun/engine/orchestrator.ts`) sits between RPC handlers and the active engine:

```
RPC handlers (tasks.ts)
  → orchestrator.executeTransition(taskId, toState)
  → orchestrator.executeHumanTurn(taskId, content)
  → orchestrator.executeRetry(taskId)
  → orchestrator.executeCodeReview(taskId, decisions)
  → orchestrator.cancel(executionId)

Orchestrator:
  1. Resolve column config, prompt, model
  2. Create execution record in DB
  3. Set up AbortController
  4. Call engine.execute(params)
  5. Consume EngineEvent stream:
     - token/reasoning → relay to UI via RPC, accumulate
     - tool_start/tool_result → persist as conversation messages
     - ask_user → write ask_user_prompt message, flip to waiting_user
     - shell_approval → write approval message, flip to waiting_user
     - usage → update execution record
     - done → persist final assistant message, update state
     - error → handle failure
  6. Update execution/task state in DB
```

**Rationale:** The orchestrator owns everything that's engine-agnostic: DB writes, RPC relay, state machine transitions, code review diff tracking. Engines are pure execution — they take a prompt and yield events.

### D5: Common tools — task management handlers only

Extracted to `src/bun/engine/common-tools.ts`:
- `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`
- `get_task`, `list_tasks`, `get_board_summary`

These export handler functions + tool metadata (name, description, JSON schema). Each engine wraps them in its native tool format:
- Native: called from `executeTool()` switch cases
- Copilot: wrapped in `defineTool()` with Zod schemas

**All other tools** (file ops, shell, search, lsp, todos, ask_me, spawn_agent, fetch) remain engine-internal.

### D6: Copilot auth — env/CLI only, zero config in YAML

Auth priority (handled by Copilot SDK automatically):
1. `COPILOT_GITHUB_TOKEN` env var
2. `GH_TOKEN` env var
3. `GITHUB_TOKEN` env var
4. Stored OAuth from `copilot` CLI login (system keychain)
5. `gh auth` credentials

No `github_token` field in workspace.yaml. If auth fails, the engine reports an error event.

**Rationale:** Copilot SDK handles the full auth chain. Adding config fields would duplicate what the SDK already manages. Users authenticate once via `copilot` CLI or set an env var.

### D7: Copilot session lifecycle — one session per execution

Each `engine.execute()` call creates a new `CopilotSession`. The session is disconnected when the execution completes or is cancelled.

Copilot's `infiniteSessions` feature handles compaction within the session. Railyin does not do any compaction for the Copilot engine.

For follow-up messages (`sendMessage`), Railyin calls `session.send()` on the active session.

### D8: Slash references resolved by orchestrator, passed as text

The orchestrator resolves `on_enter_prompt` slash references before passing to the engine. Both engines receive plain text — no engine needs to understand Railyin's prompt file system.

For the Copilot engine, `stage_instructions` is passed via `systemMessage: { content: ... }`. The prompt is sent via `session.send({ prompt: resolvedText })`.

Copilot's `skillDirectories` feature is not used in the initial implementation. Future enhancement could map `.github/prompts/` to skill directories.

### D9: Code review works via git diff, not tool interception

Railyin's code review (`tasks.getChangedFiles`, `tasks.getFileDiff`) reads from `git diff` in the worktree — not from stored `file_diff` messages. This works regardless of which engine made the changes.

The `file_diff` conversation message type becomes cosmetic only in the Copilot engine. The native engine continues to emit them from its own tool execution.

### D10: Native engine file structure

```
src/bun/engine/
├── types.ts              # ExecutionEngine, EngineEvent, ExecutionParams, EngineModelInfo
├── orchestrator.ts       # Event consumer, DB writes, RPC relay, state machine
├── resolver.ts           # Read engine config, instantiate engine
├── common-tools.ts       # Task mgmt tool handlers + metadata
├── native/
│   ├── engine.ts         # NativeEngine implements ExecutionEngine
│   ├── loop.ts           # Agentic loop (current runExecution → yields EngineEvents)
│   ├── tools.ts          # All native tools (file, shell, lsp, ask_me, todos, spawn)
│   ├── compaction.ts     # Micro-compact + full compaction
│   ├── context.ts        # Message assembly, context estimation
│   ├── session-memory.ts # Background extraction (internal)
│   └── sub-agent.ts      # spawn_agent / runSubExecution
├── copilot/
│   ├── engine.ts         # CopilotEngine implements ExecutionEngine
│   ├── session.ts        # CopilotClient lifecycle (start/stop/session management)
│   ├── events.ts         # SDK events → EngineEvent translation
│   └── tools.ts          # Wrap common-tools as defineTool()
```

## Risks / Trade-offs

- **[Bun compatibility]** The Copilot SDK is built for Node.js and spawns a CLI subprocess via JSON-RPC. Bun's Node.js compatibility is high but not perfect. → **Mitigation:** Validate early. Fallback: run Copilot CLI in server mode (`copilot --headless --port N`) and connect via `cliUrl`.

- **[Copilot SDK is public preview]** Breaking API changes possible. → **Mitigation:** Pin SDK version. The engine abstraction isolates blast radius — only `src/bun/engine/copilot/` is affected.

- **[Feature parity gap]** Copilot engine loses: prompt caching, cache break detection, micro-compact, session memory, spawn_agent, LSP tools, custom file diff messages. → **Mitigation:** These are native engine advantages, not requirements. Users choosing Copilot accept the tradeoff — they get subscription pricing and Copilot's own optimizations.

- **[Conversation format divergence]** Copilot sessions emit events in a different shape than native engine's `AIMessage[]`. Persisted `conversation_messages` will look different between engines (e.g., Copilot won't have separate `tool_call` + `tool_result` rows for its built-in tools — only for custom tools that go through Railyin). → **Mitigation:** The orchestrator normalizes to `ConversationMessage` types. Copilot's `tool.execution_start` / `tool.execution_complete` events map to `tool_call` / `tool_result` message types.

- **[Large refactor risk]** Extracting engine.ts into multiple files across native/ directory risks introducing bugs. → **Mitigation:** Phase 1 is pure extraction with zero behavior change. Verified by running existing test suite after each file split.
