## Context

Tool call messages in the conversation timeline are rendered by `ToolCallGroup.vue`, which currently extracts display information by inspecting raw argument keys (`args.path`, `args.pattern`, `args.command`…) and comparing tool names as strings (`toolName === 'read_file'`). This knowledge of what each tool's arguments mean — and which rendering variant to use — belongs in the engine layer, not the UI.

The system has two non-native engines (Claude, Copilot), each with two tool populations:

- **Claude engine**: Built-in Claude Code tools (`Bash`, `Read`, `Write`, `Glob`, `Grep`, `TodoWrite`, `WebFetch`, `Task`, …) emitted via `claude/events.ts`; plus MCP common tools (`get_task`, `create_task`, `move_task`, …) — also emitted via `events.ts` (the `tools.ts` MCP emit path is dead code — it runs in a subprocess).
- **Copilot engine**: Built-in Copilot tools (`read_file`, `create`, `edit`, `apply_patch`, `run_in_terminal`, …) emitted via `copilot/events.ts`; plus the same MCP common tools via the same path.

Both engines share `COMMON_TOOL_DEFINITIONS` from `common-tools.ts`.

## Goals / Non-Goals

**Goals:**
- Emit structured display metadata (`ToolCallDisplay`) from each engine at `tool_start` time
- Upper layers (orchestrator, UI) contain zero tool-name or argument-key strings
- The UI switches on `display.contentType` (semantic enum) instead of `toolName === 'read_file'`
- Remove confirmed dead code from `claude/tools.ts`
- Remove duplicate imports from `copilot/tools.ts`

**Non-Goals:**
- Adding new visual rendering modes beyond what currently exists
- Interactive tool call expansion with full argument inspection
- Native engine (workflow/engine.ts) changes
- Any DB schema changes

## Decisions

### D1 — Structured type, not opaque string

`ToolCallDisplay` is a structured object rather than a pre-formatted string:

```typescript
export interface ToolCallDisplay {
  label: string;          // human-readable verb: "read", "run", "move task"
  subject?: string;       // what it operates on: "migrations.ts:42", "#5 → done"
  contentType?: "file" | "terminal";  // semantic hint for result rendering
  startLine?: number;     // used by ReadView when contentType === "file"
}
```

**Rationale**: The UI already has two distinct DOM slots (`tcg__tool-name` for the verb, `tcg__primary-arg` for the subject). A structured type lets each slot be styled and truncated independently. A pre-formatted string would lose that. `contentType` keeps the UI/engine boundary clean: the engine says *what kind of data this produces*, the UI decides *which component renders it*.

**Alternative considered**: A single `displayHeader: string`. Rejected — loses independent styling, forces display decisions into the engine string formatting.

### D2 — `contentType` as semantic enum, not component name

`contentType` values are data-semantic (`"file"`, `"terminal"`), not UI-framework names. The engine layer must not reference Vue component names.

**Rationale**: Correct direction of dependency. Engine → knows about data types. UI → knows about components. Adding a new renderer on the UI side requires no engine change unless a genuinely new data type is being produced.

**Alternative considered**: `component: "ReadView"`. Rejected — wrong direction, engine couples to Vue.

### D3 — Display builders live next to the tools that own them

| Function                      | Location                   | Covers                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `buildCommonToolDisplay()`    | `engine/common-tools.ts`   | `get_task`, `list_tasks`, `create_task`, `move_task`, `message_task`, `delete_task`, `edit_task`, `get_board_summary`, `interview_me`                                                                                                |
| `buildClaudeBuiltinDisplay()` | `engine/claude/events.ts`  | `Bash`/`bash`, `Read`/`read`, `Write`/`write`, `Edit`/`edit`/`MultiEdit`, `Glob`/`glob`, `Grep`/`grep`/`rg`, `LS`/`view`, `WebFetch`/`web_fetch`, `Task`/`task`, `TodoWrite`, `apply_patch`, `create`, `skill`, `store_memory`, etc. |
| `buildCopilotNativeDisplay()` | `engine/copilot/events.ts` | `read_file`, `create`, `edit`, `apply_patch`, `run_in_terminal`, `grep_search`, `find_files`, `write_file`, `delete_file`, `rename_file`, etc.                                                                                       |

Rationale: knowledge lives as close as possible to the tool definitions and emission points that already hold that knowledge.

### D4 — `buildCommonToolDisplay()` is called from both engine emit sites

The Copilot engine calls it for any tool in `COMMON_TOOL_NAMES` before falling through to `buildCopilotNativeDisplay()`. The Claude engine's `events.ts` also calls it for common tool names before falling through to `buildClaudeBuiltinDisplay()`. This avoids duplicating common-tool display logic.

### D5 — `claude/tools.ts` dead emit code removed

The MCP handler callbacks in `claude/tools.ts` emit `tool_start`/`tool_result` into a closure that runs in a subprocess; those events never reach the main process queue. All `tool_call` messages in production have `toulu_...` / `tooluse_...` IDs from `events.ts`, never `claude_tool_...` IDs from `tools.ts`. The dead `emit` parameter and its calls are removed, also removing the `EngineEvent` import from that file.

### D6 — Orchestrator passes `display` through without interpretation

`orchestrator.ts` already serializes a JSON object for the `tool_call` message. It adds `display: event.display` — one field, no logic. No new branching or tool awareness enters the orchestrator.

## Risks / Trade-offs

- **Existing stored messages have no `display` field** — `ToolCallGroup.vue` must handle `display` being `undefined`. The fallback: show the raw tool name in the label slot and nothing in the subject slot. This is acceptable since old messages already render that way today. No migration needed.

- **Claude Code tool name instability** — Anthropic can rename built-in tools in future SDK versions (e.g. `Read` → `read_file`, `Bash` → `bash`). The display builder already handles both casing variants for the currently observed tools. New unknown tool names fall through to a default that shows the raw tool name — no crash, just no pretty label.

- **`buildCopilotNativeDisplay` and `extractWrittenFilesFromCopilotTool` share the same tool name switch** — they could be unified into a single per-tool descriptor. Deferred: the functions are simple and co-located; premature abstraction risk outweighs the small duplication.

## Migration Plan

No DB migration. No config change. Purely additive to the event contract + cleanup in `tools.ts` and `copilot/tools.ts`. Deploy is a standard build + release cycle.

Rollback: revert commits. Old `ToolCallGroup.vue` fallback handles messages without `display` (already the case today).

## Open Questions

None — design is fully grounded in the explored codebase and confirmed live data.
