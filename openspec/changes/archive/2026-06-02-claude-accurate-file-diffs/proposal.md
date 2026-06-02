## Why

The Claude engine produces inaccurate file diffs in the chat UI: `edit`, `multiedit`, and `write` tool calls show the entire file as changed (or zero changes), instead of showing only the lines that were actually modified. This happens because diff computation is incorrectly placed in `stream-processor.ts` using `git diff HEAD`, which accumulates all changes from HEAD rather than isolating the current tool call's changes.

## What Changes

- Introduce a `FileStateCache` interface and default implementation that captures file content before a write/edit/multiedit tool executes.
- Move diff computation from `stream-processor.ts` into `src/bun/engine/claude/events.ts`, the correct architectural layer (analogous to how Pi engine tool handlers compute diffs inline).
- Thread `FileStateCache` through `ClaudeRunConfig` and `translateClaudeMessage` options — same lifecycle pattern as the existing `toolMetaByCallId` map.
- `stream-processor.ts` reverts to a pure relay: `_emitFileDiffFromWrittenFiles` emits what it receives without performing any file I/O or diff computation.

## Capabilities

### New Capabilities
- `claude-file-state-cache`: A `FileStateCache` abstraction that captures pre-tool file content keyed by tool call ID, enabling accurate per-call diffs across multiple writes to the same file within a single execution.

### Modified Capabilities
- `tool-result-file-changes`: The Claude engine now always provides hunk-level diff detail for `write`, `edit`, and `multiedit` tool results (previously emitted a shallow `{ added: 0, removed: 0 }` placeholder).

## Impact

- `src/bun/engine/claude/events.ts` — gains file I/O at `tool_use` time (via `FileStateCache`) and `computeFileDiff` calls at `tool_result` time.
- `src/bun/engine/claude/adapter.ts` — `ClaudeRunConfig` gains optional `fileStateCache` field.
- `src/bun/engine/claude/engine.ts` — creates and owns the `FileStateCache` instance per execution.
- `src/bun/engine/stream/stream-processor.ts` — diff computation and before-content caching removed; `_emitFileDiffFromWrittenFiles` simplified.
- No API or RPC contract changes; no frontend changes.
