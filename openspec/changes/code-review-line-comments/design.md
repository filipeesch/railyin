## Context

The code review overlay (`CodeReviewOverlay.vue`) already supports hunk-level decisions via Monaco ViewZone widgets (`HunkActionBar.vue`). Each hunk has an Accept / Reject / Change Request action bar injected directly into the diff editor after the hunk's last modified line. Decisions are persisted to `task_hunk_decisions` using SHA-256 content hashes and survive across re-loads as long as the diff content is the same.

The current architecture has two systemic problems:

1. **Display-model patching**: when a hunk is accepted or rejected, `buildDisplayModel()` splices the original/modified line arrays to "collapse" decided hunks in the Monaco editor. This triggers a full model rebuild (setModel), scroll-position loss, ViewZone teardown/rebuild, and requires a complex `mapLineChangesToHunks()` content-search algorithm to re-correlate hunks after line numbers shift. This is ~200 lines of the most complex code in the overlay and makes every new feature (line comments, future checkpoint diffing) significantly harder.

2. **LLM payload gap**: `formatReviewMessageForLLM` sends only file path + line range + comment — no actual diff content. The model has no visibility into the code being reviewed. Additionally, `handleCodeReview` builds `originalRange: [start, start]` (both values identical), so even the line range is wrong.

This change adds line/range comments alongside hunk decisions, while simultaneously simplifying the architecture by dropping display-model patching and fixing the LLM payload.

## Goals / Non-Goals

**Goals:**
- Any line in the modified file can be commented on (not limited to diff hunks)
- Single-line and range comments supported (range via text selection)
- Comments carry the annotated lines plus ±3 surrounding context lines so the LLM payload is self-contained
- Full hunk diff content (original + modified lines) included in submit payload
- Drop display-model patching entirely — decided hunks are shown with `deltaDecorations` (visual dimming) instead of collapsing via model rebuild
- Line numbers are stable at all times — no remap, no orphan detection from display-model shifts needed
- `sent` boolean lifecycle: unsent items included in payload and marked sent on submit; next round starts fresh
- AI-reviewer-ready data model (reviewer_id / reviewer_type columns present from day one)
- Comprehensive UI tests for all scenarios

**Non-Goals:**
- AI actually authoring line comments (infrastructure only; no AI comment generation in this change)
- Threaded replies or multi-author comment discussions
- Commenting on the original (left) side of the diff
- Rich text or markdown rendering in the comment textarea
- Checkpoint-based diffing (separate change — `git stash create` snapshots per AI turn)
- Changing the reject-on-disk behavior (reject still applies `git apply --reverse` immediately; separating revert from decision is a future simplification)

## Decisions

### Decision 1: Drop display-model patching — use `deltaDecorations` for decided hunks

**Chosen:** Instead of collapsing accepted/rejected hunks by rebuilding the Monaco model, show the full `original` vs `modified` diff at all times. Decided hunks are marked with `deltaDecorations`:
- Accepted hunks: green tint on the modified-side lines
- Rejected hunks: strikethrough + muted color on the modified-side lines (since the file has already been reverted on disk by `rejectHunk`, these lines will be gone from the diff on next reload — the decoration is transient UX only)

**Why:** Display-model patching (`buildDisplayModel` + `mapLineChangesToHunks`) accounts for ~200 lines of the most complex code in the overlay. It causes: full Monaco model swaps on every accept/reject, scroll-position loss requiring save/restore, ViewZone teardown/rebuild cycles, and a content-search remap algorithm. Dropping it means:
- Line numbers are stable forever → line comment placement is trivial (just use the line number)
- No remap algorithm needed for either hunks or comments
- No orphan detection from display-model shifts (orphans can only happen if a hunk reject removes the file content — which means the file diff is reloaded anyway)
- Accept/reject becomes an instant decoration update + DB write instead of a full model rebuild cycle
- `onHunksReady` no longer needs `pendingScrollRestore`, `isInitialFileLoad`, or `pendingNavTarget` for post-rebuild recovery

**Trade-off:** Decided hunks remain visible in the diff (dimmed) instead of collapsing. This matches GitHub/GitLab PR UX where reviewed hunks never collapse.

**Alternative:** Keep display-model patching and add a parallel remap system for line comments. Rejected — the complexity doubles and every future feature must account for line-number shifts.

**What gets deleted:**
- `buildDisplayModel()` — the splice algorithm
- `mapLineChangesToHunks()` — the N×M content-search correlator
- `displayOriginal` / `displayModified` reactive refs (just use raw `original` / `modified` from API)
- `pendingScrollRestore`, `isInitialFileLoad` flags
- The accept/reject branch that calls `clearAllZones` + sets `displayOriginal`/`displayModified` (replaced with decoration update)

### Decision 2: Glyph-margin icon (click) + selection ContentWidget (range) as triggers

**Chosen:** Two complementary triggers:
1. A `+` icon in the Monaco glyph margin appears on hover for any line. Clicking it opens a `LineCommentBar` ViewZone for that single line.
2. When the user makes a multi-line selection, a small ContentWidget (positioned at the end of the selection) offers "Add comment". Clicking it opens a `LineCommentBar` ViewZone spanning the selected lines.

**Why:** This matches the GitHub PR review UX exactly without reimplementing gutter drag. Monaco's `GlyphMarginWidget` and `onMouseMove` + `onMouseDown` are the intended APIs for gutter interactivity. The ContentWidget approach for range comments is simpler than custom drag-selection handling and familiar to users.

**Alternative:** GitLab-style gutter drag. Rejected — requires custom `mousedown`/`mousemove`/`mouseup` event management on the gutter DOM, which conflicts with Monaco's own scroll and selection handling.

**Implementation detail:**
- `editor.getModifiedEditor().onMouseMove(e)`: if `e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN`, show glyph decoration on that line
- `editor.getModifiedEditor().onMouseDown(e)`: same check — open LineCommentBar ViewZone
- `editor.getModifiedEditor().onDidChangeCursorSelection(e)`: if selection spans >1 line, show ContentWidget at `e.selection.endLineNumber`

### Decision 3: `context_lines` stored alongside `line_text` — not recomputed at submit time

**Chosen:** At comment creation, capture `modified.split('\n').slice(lineStart - 4, lineEnd + 3)` (±3 lines) alongside `line_text`. Both are stored in `task_line_comments` as JSON arrays.

**Why:** By submit time the file may have changed due to further AI turns or manual edits. Recomputing context at submit time could produce misleading context (different surrounding lines). Capturing at creation time preserves the reviewer's perspective. The overhead (a few hundred bytes per comment) is negligible.

**Note:** Since we no longer patch the display model, the `modified` content is the actual file on disk. Context lines reflect the real file state at comment creation time.

### Decision 4: Full hunk diff content included in submit payload

**Chosen:** `CodeReviewHunk` gains `originalLines: string[]` and `modifiedLines: string[]` populated from the hunk's actual git diff content. These are included in `formatReviewMessageForLLM` as a mini-diff block so the model can see exactly what changed without re-reading the whole file.

**Why:** Line numbers alone, even paired with a decision, give the model no concrete "what" to work on. The current `formatReviewMessageForLLM` sends only `file path + line range + comment` which is insufficient for the model to act. The annotated diff block format (similar to `git diff` output) is a format models are extensively trained on and handle well.

**Bug fix (P5):** `handleCodeReview` currently builds `originalRange: [row.original_start, row.original_start]` — both values are the same. We add `original_end` and `modified_end` columns to `task_hunk_decisions` and populate them correctly.

**LLM message format per file:**
```
### src/auth.ts

**Hunk 1** (lines 40–44): REJECTED
  Comment: "This approach doesn't handle expired tokens"
  - const isValid = token.length > 0;
  - if (!isValid) return null;
  + const isValid = verifyTokenSignature(token);
  + if (!isValid || token.isExpired()) return null;

**Line comment** (lines 42–43):
  > const isValid = token.length > 0;
  > if (!isValid) return null;
  Comment: "Length check doesn't verify format — should use verifyTokenSignature()"
  Context:
    40:  export function validateToken(token: string) {
    41:
  > 42:    const isValid = token.length > 0;
  > 43:    if (!isValid) return null;
    44:    return processToken(token);
    45:  }
```

### Decision 5: `sent` boolean lifecycle instead of `review_round` column

**Chosen:** Both `task_hunk_decisions` and `task_line_comments` use a `sent INTEGER NOT NULL DEFAULT 0` column.

- On submit: `UPDATE task_hunk_decisions SET sent = 1 WHERE task_id = ? AND sent = 0`; same for `task_line_comments`
- LLM payload: only includes rows where `sent = 0`
- UI display: only shows line comments where `sent = 0` (hunk decisions continue to show via fresh diff query — they carry over by content-hash)

**Why:** The original `review_round INTEGER` approach had an ambiguity problem: `MAX(review_round)` is undefined when no new comments exist yet (would query show old sent comments or nothing?). The `sent` boolean is simpler, unambiguous, and requires no reasoning about round numbers.

**Alternative (rejected):**
- `review_round INTEGER` with `MAX(review_round)`: ambiguous when no new comments exist in a round; requires complex queries to distinguish current vs. past rounds.
- `sent_at TIMESTAMP`: requires reasoning about what "sent" means when a submit fails partway through; boolean is simpler.
- Delete on submit: loses ability to show review history later.

**Hunk decisions vs line comments:** Hunk decisions carry over across rounds automatically — they are keyed by content-hash, so as long as the diff is unchanged, the decision persists. The `sent` column on hunk decisions controls which ones the LLM sees (only unsent). Line comments are ephemeral — `sent = 1` means they won't appear in the overlay or LLM payload again.

### Decision 6: Unified zone registry in CodeReviewOverlay

**Chosen:** Replace the existing `Map<string, ZoneRecord>` keyed by hunk hash with a unified `Map<string, ZoneRecord>` keyed by a zone key:
- Hunk zones: `hunk:<hunkHash>:<afterLine>`
- Line comment zones: `comment:<commentId>`

`clearAllZones`, `layoutZone`, `layoutAllZones` operate over both zone types from a single map, eliminating duplication.

**Why:** Line comment zones use the exact same ViewZone lifecycle, ResizeObserver, `createApp`, and spacer-zone patterns as hunk zones. Unifying the registry reduces the total lines of lifecycle management code and makes both zone types first-class.

**Note:** With display-model patching removed, `clearAllZones` is only called on file switch or view-mode toggle — not on every accept/reject. This dramatically reduces the frequency of zone teardown/rebuild.

### Decision 7: `LineCommentBar.vue` — two active states, lightweight component

**Chosen:** A single component handles two states via a `state` prop:
- `open`: textarea focused, Cancel / Post buttons
- `posted`: read-only comment display, Delete button

**Why orphaned state is dropped:** With display-model patching removed, line numbers are stable. Comments never need to be "remapped" after accept/reject. The only way a comment's lines can disappear is if the reviewer rejects a hunk that contains those lines — but `rejectHunk` reverts the file on disk and triggers a full diff reload, so the comment's line numbers remain valid in the new diff (pointing at the reverted content). If the lines truly disappear (file deletion), the comment becomes stale but this is an edge case handled by the file-level reload — no per-comment orphan tracking needed.

Same `mousedown.stop` / `keydown.stop` guards as `HunkActionBar`.

### Decision 8: Accept/reject becomes decoration-only update

**Chosen:** When a hunk is accepted:
1. `setHunkDecision` IPC call (DB write — same as today)
2. Apply `deltaDecorations` on the modified editor to tint the hunk's lines greenish
3. Update `HunkActionBar` props to reflect the decision (shows badge in review mode)
4. No model rebuild, no zone teardown/rebuild, no scroll save/restore

When a hunk is rejected:
1. `rejectHunk` IPC call (reverts file on disk + DB write — same as today)
2. The handler returns new `FileDiffContent` — update `diffContent.value`
3. Apply new models to Monaco (since the file changed on disk)
4. `onHunksReady` fires naturally, re-injects zones for the new diff

**Why:** Accept is now instant (no async model swap). Reject still requires a model swap because the file content actually changes, but this is the existing behavior — no additional complexity.

## Risks / Trade-offs

- **Decided hunks visible in diff**: Accepted/rejected hunks remain visible (dimmed) instead of collapsing. Trade-off accepted — this matches GitHub/GitLab UX and eliminates ~200 lines of the most complex code.
- **`deltaDecorations` API**: Monaco's decoration API is stable and well-documented, but we need to ensure decorations are cleared and re-applied correctly on file switch. Mitigation: clear decorations in `clearAllZones`, re-apply in `injectViewZones`.
- **`sent` column migration**: Adding a column to `task_hunk_decisions` requires an `ALTER TABLE`. SQLite ALTER TABLE ADD COLUMN is safe and non-destructive. Default value `0` means existing rows are treated as unsent (correct — they haven't been through the new submit flow).
- **ViewZone height after reject reload**: After a reject, `rejectHunk` returns new `FileDiffContent` which triggers model swap → `onHunksReady`. Zones are freshly injected. The existing `FALLBACK_ZONE_HEIGHT_PX` and `ResizeObserver` pattern handles this.
- **Concurrent hunk decision + comment on same line**: A user accepts a hunk and has a comment on a line within it. The comment stays in place (line numbers are stable). The hunk shows an "accepted" decoration. Both appear in the submit payload. This is expected.
- **Future checkpoint diffing**: Dropping display-model patching does not conflict with future checkpoint-based diffing (`git stash create` snapshots). Checkpoints change the *input* to the diff (checkpoint..worktree instead of HEAD..worktree) but don't affect how the diff is *displayed*.

## Migration Plan

1. Add DB migration: create `task_line_comments` table; `ALTER TABLE task_hunk_decisions ADD COLUMN sent INTEGER NOT NULL DEFAULT 0`; `ALTER TABLE task_hunk_decisions ADD COLUMN original_end INTEGER NOT NULL DEFAULT 0`; `ALTER TABLE task_hunk_decisions ADD COLUMN modified_end INTEGER NOT NULL DEFAULT 0`.
2. Remove `buildDisplayModel()`, `mapLineChangesToHunks()`, `displayOriginal`/`displayModified` refs, `pendingScrollRestore`/`isInitialFileLoad` flags from `CodeReviewOverlay.vue`.
3. Add `deltaDecorations` for decided hunks in `injectViewZones`.
4. Add new IPC handlers for line comments (additive — no existing handlers change signature).
5. Extend `rpc-types.ts` with new types (additive).
6. Extend `formatReviewMessageForLLM` and `handleCodeReview` — no breaking change to existing behavior; line comments section is simply empty for tasks with no comments.
7. Frontend component changes are isolated to `MonacoDiffEditor.vue`, `CodeReviewOverlay.vue`, and the new `LineCommentBar.vue` — no other UI components affected.
8. No rollback complexity — new table and new IPC handlers, no existing API signatures changed.
