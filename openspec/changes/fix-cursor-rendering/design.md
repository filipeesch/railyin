## Context

The Cursor engine (`src/bun/engine/cursor/`) runs the `@cursor/sdk` in a Node.js subprocess (`worker.mjs`) with IPC over line-delimited JSON. SDK streaming events are translated to Railyin's `EngineEvent` format in two places: `events.ts` (Bun side, receives via IPC) and `worker.mjs` (Node side, converts before IPC). These two copies are manually kept in sync and currently diverge.

The translation layer has three bugs:
1. `buildCursorToolDisplay` checks PascalCase names (`"Read"`, `"Shell"`) but the SDK sends lowercase (`"read"`, `"shell"`) — zero matches
2. `normalizeCursorToolResult` flattens structured results (`{ stdout: "..." }`, `{ diffString: "..." }`) to plain strings
3. Display metadata is only patched post-hoc in `engine.ts._run()` for `tool_start` events, never for `tool_result`

The result: tool call collapsibles show no label, no file/command, and no result preview.

## Goals / Non-Goals

**Goals:**
- Fix display metadata matching: use lowercase tool names
- Extract structured result data into `detailedResult` (shell stdout/stderr) and `writtenFiles` (edit/write diff hunks)
- Build display, detailedResult, contentBlocks, and writtenFiles at translation time in both `events.ts` and `worker.mjs`
- Extract shared translation module to eliminate duplication
- Remove the post-hoc display fallback in `engine.ts._run()`

**Non-Goals:**
- UI/frontend changes (the contract already supports all fields)
- Changing the EngineEvent or StreamEvent types (already support display, detailedResult, contentBlocks, writtenFiles)
- Fixing thinking/reasoning events (empty text is a Cursor SDK behavior, not a Railyin bug)
- Modifying the stream processor or conversation store

## Decisions

### D1 — Extract shared `translate-events.ts` module
Move `translateCursorMessage`, `normalizeCursorToolResult`, `unwrapCursorToolName`, and `buildCursorToolDisplay` into `src/bun/engine/cursor/translate-events.ts`. Both `events.ts` and `worker.mjs` reference it.

For `worker.mjs`, since it's a `.mjs` file running under plain Node (not Bun), we keep a small inline copy of the translation functions rather than adding a bundling step. The shared module serves as the single source of truth for testing and documentation; the worker.mjs copy is kept minimal and referenced from the shared module.

**Alternative considered**: Keep both copies fully independent. Rejected — we've already duplicated translateCursorMessage and it diverged.

**Alternative considered**: Use ESM import from worker.mjs. Rejected — adds build complexity for a single file.

### D2 — Lowercase tool name matching in `buildCursorToolDisplay`
Match the actual SDK tool names which are lowercase: `read`, `write`, `edit`, `MultiEdit`, `shell`, `delete`, `glob`, `grep`. Also handle `railyin_*` and `mcp` wrappers for custom tools.

This mirrors Copilot's approach where tool names in `buildCopilotNativeDisplay` match the SDK's actual names (`read_file`, `bash`, `create`, etc.).

### D3 — Shell result extraction matches Copilot pattern
Extract `stdout` from `result.value.stdout` into `detailedResult`. If `stderr` is non-empty, append it with a separator. This matches Copilot's `detailedContent` extraction.

### D4 — Edit/write diffString parsing matches Copilot pattern
When `result.value.diffString` exists (unified diff format), parse it into `writtenFiles` with `hunks` containing `{ type: "added"/"removed"/"context", old_line, new_line, content }`. This enables the frontend's `FileDiff` component to render actual diff previews.

### D5 — Delete/empty result handling
When `result.value` is `{}` (delete confirmed, no content), emit `detailedResult: "(file deleted)"` so the UI shows meaningful text instead of blank.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `worker.mjs` and `translate-events.ts` diverge again | Keep worker.mjs copy minimal; add explicit comment pointing to shared module for updates |
| Diff parsing is expensive | Parsing only happens on completed write/edit tool results, not on every event. Copilot already does this with the same approach |
| Shell stdout could be very large | Copilot already handles this; the result string is the same size as before, just now split into result + detailedResult |
| Lowercase matching might break if SDK changes to PascalCase | The switch statement lists all known names explicitly; easy to update if SDK changes |
