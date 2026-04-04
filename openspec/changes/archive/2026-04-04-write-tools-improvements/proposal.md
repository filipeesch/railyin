## Why

Write tools currently return opaque success strings to both the model and the UI, giving the model no signal about what actually changed and the human no visual feedback on what the agent edited. Adding structured diff output and a `delete_file` tool closes both gaps without increasing LLM token cost.

## What Changes

- **Structured diff return from all write tools**: `write_file`, `patch_file`, `delete_file`, and `rename_file` now emit a `file_diff` message (new `MessageType`) alongside the existing `tool_result` message. The `file_diff` message carries a `FileDiffPayload` with per-hunk line-level change data. It is never sent to the LLM.
- **Compact LLM acknowledgement (Option C)**: The string returned to the model gains change counts — e.g. `"OK: patched src/foo.ts (+2 -1 at line 47)"`. Gives the model a lightweight sanity check without token overhead.
- **Myers diff algorithm (in-process)**: A standalone TS implementation of the Myers diff algorithm is used to compute `write_file` overwrites (the only case where before/after aren't already known from arguments). No subprocess. No external dependency.
- **`delete_file` tool**: New write-group tool that deletes a file from the worktree. Returns line count removed to the LLM; `file_diff` metadata records `removed: N` (no full content stored).
- **Collapsed diff UI component**: New `FileDiff.vue` component renders `file_diff` messages as a collapsed header showing `+added / -removed` counts. Clicking expands to show unified diff view with 3 lines of context, GitHub-style green/red line backgrounds, and line number gutters.
- **`file_diff` excluded from LLM context**: `compactMessages` in `engine.ts` filters out `file_diff` messages — they exist only for the human in the UI.

## Capabilities

### New Capabilities
- `file-diff-visualization`: The UI renders file changes from agent write operations as interactive collapsed diff components, showing per-hunk line additions and removals with surrounding context.

### Modified Capabilities
- `write-tools`: All four write tools now return structured diff metadata alongside the existing success string. `delete_file` is added as a new operation in this group.

## Impact

- `src/bun/workflow/tools.ts` — all four write tool executors (return type change, Myers diff for `write_file` overwrite, `delete_file` added)
- `src/bun/workflow/engine.ts` — call site threads `file_diff` message emit; `compactMessages` excludes new type
- `src/shared/rpc-types.ts` — `MessageType` gains `"file_diff"`; `FileDiffPayload` type exported
- `src/mainview/components/FileDiff.vue` — new component (collapsed diff viewer)
- `src/mainview/components/MessageBubble.vue` — new branch for `file_diff` type
- No DB schema changes (uses existing `content` + `metadata` columns on `conversation_messages`)
- No new dependencies
