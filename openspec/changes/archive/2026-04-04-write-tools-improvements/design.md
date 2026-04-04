## Context

Write tools (`write_file`, `patch_file`, `delete_file`, `rename_file`) in `src/bun/workflow/tools.ts` currently return plain strings. The engine stores these verbatim in `tool_result` conversation messages and forwards them unchanged to the LLM. The UI renders them in a `<pre>` tag with truncation at 800 chars. There is no visual diff, no structured change data, and the model receives no line-count feedback.

The `conversation_messages` table has a `metadata` TEXT column that is already used for `tool_call_id` routing but is otherwise unused for write tools. A `file_diff` message type (stored in the same table) will carry the rich diff payload without touching the DB schema.

## Goals / Non-Goals

**Goals:**
- All write tools return a compact `+N -M` summary string to the LLM
- All write tools emit a `file_diff` message (new `MessageType`) for UI consumption only
- `file_diff` messages are never sent to the LLM (filtered in `compactMessages`)
- `write_file` overwrite produces a per-line diff via in-process Myers algorithm
- `patch_file` derives its diff for free from arguments (anchor = removed, content = added)
- `delete_file` is added as a new write-group tool; records line count removed
- `rename_file` records from/to paths only, no content diff
- New `FileDiff.vue` component renders collapsed diff with 3 context lines, GitHub-style
- `delete_file` UI shows count only (no full content stored in metadata)

**Non-Goals:**
- Undo/rollback of write operations (deferred)
- Multi-patch in a single `patch_file` call (deferred)
- Sub-agent write diffs surfaced in parent conversation (sub-agents return text summaries)
- Syntax highlighting inside the diff component

## Decisions

### D1: Two messages per write operation, not one

Each write tool emits two DB rows: the existing `tool_result` (sent to LLM) and a new `file_diff` (UI-only). Alternative was embedding the diff in `tool_result.metadata` alongside `tool_call_id`.

**Rationale**: The `tool_result` metadata already carries LLM-routing data (`tool_call_id`, `name`). Mixing a large diff payload there conflates two different concerns. Separate types give clean filtering in `compactMessages`, a clean branch in `MessageBubble.vue`, and a future query path ("show all files changed by this task"). Cost is one extra DB write per tool call — negligible.

### D2: Myers diff only for `write_file` overwrite

`patch_file` arguments already contain the removed text (anchor) and added text (content), so no algorithm is needed — the diff is implicit. `delete_file` only needs a line count. `rename_file` has no content change. Only `write_file` on an existing file has no structural information about what changed, requiring a real diff.

**Rationale**: Keeps complexity minimal. Myers is a small, well-understood algorithm (~40 lines). Implemented as a standalone function in `tools.ts`, no external dependency.

### D3: `delete_file` stores count only in metadata, not full content

Deleted content is recoverable via `git checkout` in the worktree. Storing the full content in `metadata` adds noise and potentially large payloads for files that are gone.

**Rationale**: The UI shows `"deleted src/foo.ts (120 lines)"` — enough for the human to understand impact. If they need the content, git is there.

### D4: 3 context lines per hunk in `FileDiffPayload`

GitHub default. Enough to understand the surrounding code without being noisy.

### D5: LLM receives compact counts string (Option C)

`"OK: patched src/foo.ts (+2 -1 at line 47)"`. The model sees a change summary that lets it sanity-check whether its intent landed (e.g. it expected +5 -3 but sees +2 -1, it can `read_file` to investigate). Full diffs to the LLM are token-expensive and redundant — the model already has its own arguments in context.

## Risks / Trade-offs

- **[Risk] Myers diff on large files** → The diff is computed only for `write_file` overwrites. Reading the before-content adds one synchronous `readFileSync` call before the write. For files >500KB the tool already rejects reads; the same guard applies. Mitigation: cap diff computation at the existing 500KB file size limit; return `hunks: null` with counts only if file exceeds threshold.

- **[Risk] `file_diff` messages accumulate without utility in long conversations** → Each write op adds a DB row that is never sent to the LLM. Mitigation: task deletion already cascades-deletes all conversation_messages; no separate cleanup needed.

- **[Risk] `patch_file` diff line numbers may be off for `start`/`end` positions** → `start` prepends at line 1, `end` appends after last line — both trivial. Only anchor-based positions need a line number scan. Mitigation: scan for anchor line number before writing (one pass).

## Migration Plan

No DB schema changes. The `file_diff` message type is additive — existing conversations simply won't have any `file_diff` rows. `MessageBubble.vue` falls through to its existing `v-else` for unknown types, so old conversations render unchanged.

Rollout: ship backend changes (tools.ts + engine.ts + rpc-types.ts) and frontend changes (FileDiff.vue + MessageBubble.vue) together in one build.

## Open Questions

- None. All decisions resolved during exploration phase.
