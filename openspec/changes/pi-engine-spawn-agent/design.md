## Context

The Pi engine (`src/bun/engine/pi/engine.ts`) is a local-LLM harness built on `@mariozechner/pi-agent-core`. It was shipped without `spawn_agent` support. The native/Copilot engines implement spawn via engine-loop interception (intercepting the model's tool call before `executeTool`), but the Pi engine uses a different execution model: tools are native `AgentTool.execute()` functions registered directly on Pi's `Agent`. There is no loop-level interception point.

The task description mentioned Pi SDK branching (`fork()`/`navigateTree()`) — this does NOT exist in `@mariozechner/pi-agent-core@0.73.0`. Sub-agents must be fresh `new Agent()` instances, not branches of the parent session.

The old native engine's `runSubExecution` gave children the parent's assembled conversation history (`parentContext`) for prompt cache sharing. Pi targets weak local models (Qwen3, Llama) with 32K–64K context windows — inheriting parent history would exhaust the budget before children do any work.

## Goals / Non-Goals

**Goals:**
- Add `spawn_agent` tool to the Pi engine as a native `AgentTool`
- Support named agents resolved from `.railyin/agents/` (project) → `~/.railyin/agents/` (user) → `config/agents/` (built-in defaults)
- Stream child tokens and tool events to the parent's UI nested under the spawn_agent call via `parentCallId`
- Keep child context fresh — instructions only, no parent conversation history
- Block recursion architecturally (no `spawnConfig` on children means no `spawn_agent` tool)
- Fix two pre-existing `PiEngine` bugs uncovered during design

**Non-Goals:**
- Persistent child execution records (no DB rows, no UI task cards for children)
- Pi SDK branching / session forking (not available in current SDK)
- Cross-engine spawn (Pi children always use Pi's Agent, not Copilot/Claude)
- Automatic LSP validation of child output (parent is responsible for semantic validation)
- Concurrency limiting (Ollama/LM Studio queue requests internally; add later if needed)

## Decisions

### D1: Native AgentTool, not loop interception

**Decision:** `spawn_agent` is implemented as a native `AgentTool.execute()` registered on the Pi `Agent`, not intercepted at the engine loop level.

**Rationale:** Pi's `Agent` doesn't expose the interception point used by the native engine. Forcing loop interception would require rewriting the Pi engine's execution model. Native tools are cleaner, testable in isolation, and consistent with how all other Pi tools work.

**Alternative considered:** Wrapping `agent.subscribe()` to detect `tool_execution_start` events for `spawn_agent` and short-circuit. Rejected — Pi executes tools inside its own loop; intercepting via subscribe is a race condition.

### D2: Fresh context (instructions only, no parent history)

**Decision:** Children receive only their `instructions` string as the first user message. No parent system prompt, no conversation history.

**Rationale:** Pi targets local models with 32K–64K context windows. The parent's conversation history alone can be 10K–20K tokens. Injecting it into every child would consume most of the budget before the child does any work. The old engine's `parentContext` feature exists for prompt cache sharing — irrelevant for local models.

**Alternative considered:** Inherit parent system prompt only (not history). Rejected — system prompt on complex tasks can be 3K–5K tokens; adds coupling for marginal benefit. Agent file system prompt provides the persona without per-execution overhead.

### D3: SpawnConfig injected into AllToolsOptions

**Decision:** A new `SpawnConfig` interface is added to `AllToolsOptions`. When absent, `spawn_agent` is not added to the tool set. This is the recursion guard.

```typescript
interface SpawnConfig {
  model: Model<"openai-completions">;
  streamFn: StreamFn;
  agentResolver: AgentResolver;
  onChildEvent: (spawnCallId: string, event: EngineEvent) => void;
}

interface AllToolsOptions {
  harnessCtx: HarnessContext;
  commonCtx: CommonToolContext;
  columnGroups?: string[];
  spawnConfig?: SpawnConfig;  // absent → no spawn_agent tool
}
```

**Rationale:** Clean DI — no engine reference in tools, no circular imports. Absence of `spawnConfig` is the recursion guard without any explicit depth tracking.

### D4: Child event bridging via onChildEvent callback

**Decision:** `PiEngine.createManagedExecution()` passes an `onChildEvent` callback (closure over the local `events[]` array) in `SpawnConfig`. The spawn tool calls it for each translated child event.

**Rationale:** The Pi engine's event stream is a local `events: EngineEvent[]` array drained by an AsyncGenerator. Tools execute inside `agent.subscribe()` callbacks and have no direct access. A callback closure is the minimal bridge with no Pi SDK changes.

**Alternative considered:** Use Pi SDK's `onUpdate` on the tool's `execute()` to tunnel events. Rejected — abuses the partial-result semantics and requires `afterToolCall` decode logic in the engine.

### D5: Named agents from .railyin/agents/ (AgentResolver)

**Decision:** A new `AgentResolver` class handles agent definition loading from a 3-level resolution chain: project `.railyin/agents/<name>.md` → user `~/.railyin/agents/<name>.md` → built-in `config/agents/<name>.md`. Frontmatter defines tools and optional model; body is the system prompt.

**Rationale:** Consistent with how `config/workflows/` works — defaults shipped, project-level override possible, user-global override for personal preferences. Agent definitions are version-controllable alongside the codebase.

**Agent file format:**
```markdown
---
name: implementer
tools: [read, write, lsp, search]
model: lmstudio/qwen3-14b   # optional
---

You are an expert implementer. You receive skeleton files...
```

### D6: Tool ownership — agent file owns tools for named agents

**Decision:** When `agent` is specified in spawn args, the agent file's frontmatter `tools` array is the tool set — the caller does NOT pass a `tools` array. For anonymous children (no `agent` field), the caller must provide `tools`.

**Rationale:** The agent file is a self-contained capability definition. Allowing callers to override tools would undermine the agent's designed constraints (e.g., a read-only reviewer getting write tools).

### D7: instructions as first user message, agent file body as system prompt

**Decision:** `instructions` always becomes the first user message (the per-invocation task). The agent file body becomes the system prompt (the persona). When both are provided, they stack.

### D8: Technical-only success signaling

**Decision:** The spawn tool reports `isError: true` only for technical failures (agent threw, `agent.state.errorMessage` set). Logical correctness is the parent's responsibility.

**Rationale:** LSP validation is too narrow (only works for typed languages with LSP configured). Structured JSON result is unreliable with weak local models. The filesystem is the source of truth — the parent can read files and verify output with its own tools.

### D9: Result extraction from last assistant message

**Decision:** After `agent.waitForIdle()`, extract the text content from the last `AssistantMessage` in `agent.state.messages`.

**Rationale:** Pi agents don't have a return value. The final assistant turn's text is the natural summary.

### D10: Hard cap MAX_CHILDREN=10

**Decision:** The spawn tool rejects calls with more than 10 children with a clear error.

**Rationale:** Prevents accidental runaway spawning. Ollama/LM Studio handle concurrency internally, so no semaphore is needed, but an absolute guard prevents abuse.

## Risks / Trade-offs

**Risk: Interleaved child event streams are confusing in UI**
→ Child events carry `parentCallId` (spawn_agent's tool call ID) only — **no `isInternal: true`**. `isInternal` in `stream-processor.ts` (lines 237, 272) suppresses events entirely (no DB, no IPC). Child events must reach the DB and UI, so they must not be internal. The `EngineEvent` `token` type is extended with `parentCallId?: string`; stream-processor passes it as `parentBlockId` on `text_chunk` emit. `StreamBlockNode.vue` and `conversation.ts` already render nested children under `tool_call` blocks via `parentBlockId` — no frontend changes needed. Multiple concurrent children interleave events under their respective parent call blocks, grouped by `parentCallId`.

**Risk: Weak models fail to extract result from last assistant message**
→ Local models sometimes end turns with incomplete thoughts. Mitigation: built-in agent system prompts instruct the model to produce a clear summary at the end.

**Risk: No eviction on PiEngine session/harnessContext maps**
→ Pre-existing issue. `sessions` and `harnessContexts` grow unboundedly. Addressed as cleanup in this change: add eviction when tasks are archived/deleted.

**Risk: AgentResolver reads files on every spawn call**
→ Agent definitions are typically small and stable. Acceptable for now. Add caching in a follow-up if profiling shows impact.

**Risk: cancel() aborts all sessions (pre-existing bug)**
→ `PiEngine.cancel()` iterates all `sessions` values and calls `abort()` on each. Fix: track `executionId → conversationId` and abort only the target session.

## Migration Plan

No DB migrations. No API changes. No frontend changes.

Rollout:
1. Merge change to main
2. `spawn_agent` becomes available in Pi engine immediately when `agents` tool group is in a column's `tools` config
3. Built-in agents in `config/agents/` are available out of the box
4. Projects can add `.railyin/agents/` overrides at any time

Rollback: remove `agents` from column `tools` config in `config/workflows/*.yaml`.

## Open Questions

None — all design decisions resolved during exploration.
