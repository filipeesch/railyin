## Context

The Pi engine manages one `AgentSession` per conversation, reusing it across executions. On session reuse, `getOrCreateSession()` updates the agent with fresh context by writing directly to `agent.state.tools`. This bypasses the Pi SDK's internal tool registry and replaces the full tool array — including SDK built-in tools (`read`, `grep`, `find`, `ls`) that were registered at session creation time. From turn 2 onwards, calling `read` returns "tool not found".

Separately, the `run_command` tool description in `shell.ts` still references `search_text`, a tool removed in a prior release. The model reads this description and tries to call it, failing every time.

The Pi SDK exposes `session.setActiveToolsByName(names: string[])` which operates on the session's internal registry — the only correct way to change the active tool set after session creation.

## Goals / Non-Goals

**Goals:**
- SDK built-in tools (`read`, `grep`, `find`, `ls`) remain available on all turns
- `search_text` stops appearing as a model-attempted tool call
- `CommonToolContext` fields stay current without rebuilding tools every turn
- All stale references to removed tools are cleaned up

**Non-Goals:**
- Wiring column `tools:` YAML config to Pi engine (columnGroups dead code — separate task)
- Clearing or migrating existing Pi session `.jsonl` files
- Adding system prompt notes about removed tools (model recovers on its own)
- Removing the `readFileTool` dead code from `read.ts` (separate cleanup)

## Decisions

### D1 — Use `setActiveToolsByName()` instead of direct `agent.state.tools` assignment

`agent.state.tools = tools` replaces the entire tool array. When `tools` is `buildAllTools()` output (custom tools only), SDK built-ins disappear.

`session.setActiveToolsByName(names)` reads from the SDK's registry (populated at `createAgentSession` time with both built-ins and custom tools) and enables only the named tools. This is the correct SDK API.

**Alternative considered**: Keep direct assignment but merge SDK tools into the custom array. Rejected: requires the engine to know and maintain the SDK built-in names in two places (creation allowlist + reuse merge), diverging from the SDK's own registry.

### D2 — Introduce a mutable per-conversation `CommonToolContext` ref

Currently, `commonCtx` is rebuilt on every execution. Tool closures capture the context at build time — if we stop rebuilding tools, closures in a long-lived session hold the context from creation time. This is fine for `boardTools`, `task`, and callbacks (all effectively stable), but `runtime.worktreePath` and `runtime.lspManager` can change as worktrees become available.

Solution: add `commonCtxRefs = Map<conversationId, CommonToolContext>` alongside `harnessContexts`. On first execution, create and store it. On reuse, mutate the mutable `runtime` fields in-place. Tool closures closed over the stored ref automatically see the latest values — same pattern as `harnessCtx.worktreePath` mutation.

This also eliminates the `buildAllTools()` call on session reuse (tools are built once at session creation).

```
First turn:
  commonCtxRef = new CommonToolContext(...)   stored
  tools = buildAllTools({ commonCtxRef })     closures capture ref
  createAgentSession({ customTools: tools })

Subsequent turns:
  commonCtxRef.runtime.worktreePath = newPath  mutate in-place ✓
  commonCtxRef.runtime.lspManager = newManager  mutate in-place ✓
  session.setActiveToolsByName([...sdkBuiltins, ...customNames])  re-sync active set ✓
  // no tool rebuild needed
```

**Alternative considered**: Build a new `CommonToolContext` and call `buildAllTools()` each turn (current approach), then merge the result with SDK built-in names for `setActiveToolsByName`. Rejected: unnecessary overhead and the merge approach still requires hardcoding SDK built-in names outside of `createAgentSession`.

### D3 — Description fix is the minimum viable fix for `search_text` ghost calls

The `run_command` description tells the model to prefer `search_text`. Removing this reference eliminates the guidance that causes ghost calls. SDK tool names that replace it (`grep`, `find`) are already registered in every session. No system prompt changes needed.

## Risks / Trade-offs

**[Risk] Mutable ref and callback staleness** → `workflow.onTransition`, `workflow.onHumanTurn`, `workflow.onCancel`, `workflow.onTaskUpdated` are also stored in `CommonToolContext`. These callbacks are set by the orchestrator at execution time and could change if an engine is reused for a different task. Mitigation: also update the `workflow` callbacks in-place on reuse — same as `runtime` fields.

**[Risk] Old Pi session `.jsonl` files contain `search_text` calls** → Model may see these in restored context and retry the ghost tool call. Mitigation: Pi SDK returns a tool-not-found error which the model handles by retrying with a different tool. Acceptable.

**[Risk] `setActiveToolsByName()` ignores unknown names silently** → Per SDK docs: "Unknown tool names are ignored." If the engine passes a name not in the registry, it's silently dropped with no error. Mitigation: the allowlist at session creation and the names passed to `setActiveToolsByName` are derived from the same `buildAllTools()` output — they will always match the registry.

## Migration Plan

No DB migrations. No config changes. The session `.jsonl` format is unchanged. Changes are backward compatible — existing sessions work correctly once the code is deployed.

Rollback: revert the three changed lines in `getOrCreateSession()`. No data to undo.
