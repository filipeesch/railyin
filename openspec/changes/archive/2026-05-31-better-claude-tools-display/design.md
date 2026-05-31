## Context

Tool call display labels are computed by per-engine display builder functions. When Claude calls a railyin tool, the Claude SDK wraps it in the MCP namespace as `mcp__railyin__<tool-name>`. The existing `COMMON_TOOL_NAMES` set and `buildCommonToolDisplay` only know the bare names (`decision_request`, not `mcp__railyin__decision_request`), so the routing check fails and the raw MCP-prefixed string becomes the label.

Additionally, the `isInternalClaudeToolName` guard uses an exact string match for `report_intent`, which misses `mcp__railyin__report_intent`, causing internal tool calls to surface in the UI.

The Pi and Copilot engines inject railyin tools directly and are unaffected. OpenCode currently emits no `display` field at all.

## Goals / Non-Goals

**Goals:**
- Railyin common tools called from Claude show clean labels in the UI (e.g. `decision request`, `record decision`)
- `report_intent` and other internal railyin tools remain hidden from the UI even when invoked via MCP prefix
- All unrecognized tool names fall back to a humanized label (`_` → space, `mcp__` prefix stripped, `__` → space)
- Deduplicate `stripWorktreePath` (currently copy-pasted in two engine event files)
- OpenCode engine `tool_start` events carry a populated `display` field

**Non-Goals:**
- Changing the frontend rendering or `ToolCallDisplay` schema
- Modifying Pi or Copilot display logic (already correct)
- Adding new UI features to the tool call block component

## Decisions

### Decision: Strip railyin prefix before routing, not inside the display builder

The normalization happens in `claude/events.ts` before the `COMMON_TOOL_NAMES.has()` check, not inside `buildCommonToolDisplay`. This keeps `buildCommonToolDisplay` transport-agnostic — it receives bare tool names regardless of how they were delivered.

**Alternatives considered:**
- Stripping inside `buildCommonToolDisplay`: rejected because it would couple a shared utility to Claude-SDK naming conventions
- Adding MCP-prefixed names to `COMMON_TOOL_NAMES`: rejected because the set is used for routing across all engines, not just Claude

### Decision: `humanizeToolName` handles all unrecognized names generically

Rather than a Claude-specific fallback, a single `humanizeToolName(name)` utility replaces raw `name` in every default/fallback case across all engines. The algorithm: strip `mcp__` prefix → replace `__` with space → replace `_` with space. This makes external MCP tools (`mcp__other-server__do_thing` → `other-server do thing`) readable without needing server-specific configuration.

**Alternatives considered:**
- Per-engine fallback logic: rejected as duplication
- Leaving external MCP tool names as-is: rejected per user requirement

### Decision: New helpers live in `tool-display.ts`

`stripRailyinMcpPrefix`, `humanizeToolName`, and the deduplicated `stripWorktreePath` all go into `src/bun/engine/tool-display.ts`, the existing home of display utilities. The call site for MCP normalization stays in `claude/events.ts` since only the Claude engine needs it.

### Decision: OpenCode gets `buildCommonToolDisplay` fallback via shared helper

`opencode/event-translator.ts` is extended to import and call `buildCommonToolDisplay` for known tools and `humanizeToolName` for everything else — exactly the same pattern used by Pi's `buildPiToolDisplay`.

## Risks / Trade-offs

- [Coupling to server name `"railyin"`] → Acceptable: the server name is part of the internal MCP architecture and is unlikely to change. It's isolated to a single helper in `tool-display.ts`.
- [humanizeToolName changes visible labels for existing unrecognized tools] → Low impact: the old fallback was the raw unrecognized name, which was never useful. The new fallback is strictly better.
- [`isInternalClaudeToolName` prefix strip could inadvertently hide legitimate tools] → Mitigated: the strip only applies before the existing `startsWith("internal_")` and exact-match checks. A non-internal tool named `mcp__railyin__x` would only be filtered if `x` matches an existing internal pattern.
