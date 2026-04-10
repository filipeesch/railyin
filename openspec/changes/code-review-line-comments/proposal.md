## Why

The current code review overlay supports hunk-level decisions (accept / reject / change_request) but gives reviewers no way to annotate specific lines or ranges of lines with targeted feedback. This forces reviewers to write vague hunk-level comments when they want to point the AI at a precise location in the code — like a GitLab or GitHub PR review. Adding line-level comments makes AI-driven code review meaningfully more precise and actionable.

Additionally, the existing architecture has two systemic problems that compound with the addition of line comments:

1. **Display-model patching**: accepted/rejected hunks trigger a full Monaco model rebuild that shifts all line numbers, requiring a complex content-search remap algorithm (`mapLineChangesToHunks`, `buildDisplayModel`). This makes line comment placement unreliable and adds ~200 lines of fragile lifecycle code.
2. **LLM payload gap**: `formatReviewMessageForLLM` currently sends only file path + line range + comment — no actual diff content. The model cannot see the code being reviewed.

This change resolves both issues alongside adding line comments by dropping display-model patching (decided hunks are dimmed via decorations instead of collapsed) and enriching the LLM payload with full diff content.

## What Changes

- **Drop display-model patching**: accepted/rejected hunks are shown with `deltaDecorations` (green tint / strikethrough) instead of collapsing via model rebuild. Line numbers remain stable at all times. `buildDisplayModel()`, `mapLineChangesToHunks()`, scroll-save/restore, and model-rebuild-on-decide are removed.
- **Line comments via glyph margin + selection**: reviewers can click a glyph-margin `+` icon to comment on any single line, or select a range and click an "Add comment" ContentWidget to comment on multiple lines
- Comments are stored in a new `task_line_comments` table, independent of hunk decisions
- Each comment captures the annotated line text and surrounding context lines (±3) so the model receives an annotated diff-style block
- **`sent` boolean lifecycle**: both `task_hunk_decisions` and `task_line_comments` use a `sent INTEGER DEFAULT 0` column. On submit, unsent items are included in the payload and marked `sent = 1`. Next review round starts fresh — only unsent items are shown/sent.
- **Full diff content in LLM payload**: `CodeReviewHunk` gains `originalLines` / `modifiedLines` fields populated from git diff. `formatReviewMessageForLLM` emits annotated diff blocks per file so the model sees the actual code.
- **Fix lossy ranges**: `handleCodeReview` now stores and sends `original_end` / `modified_end` (currently both values are identical to `_start`)
- AI reviewers can add line comments in future (table designed with `reviewer_id` / `reviewer_type` columns from day one)
- UI tests cover all scenarios

## Capabilities

### New Capabilities
- `code-review-line-comments`: Line and range comments on any line in the modified diff, independent of hunk decisions, with per-round lifecycle and LLM-ready context payloads

### Modified Capabilities
- `code-review`: Display-model patching replaced with decoration-based decided-hunk visualization; submit payload extended with full hunk diff content and per-file line comments; `sent` boolean lifecycle for multi-round reviews; lossy range fix

## Impact

- `src/bun/db/` — DB migration: `task_line_comments` table; `ALTER TABLE task_hunk_decisions ADD COLUMN sent INTEGER NOT NULL DEFAULT 0` + `original_end` / `modified_end`
- `src/bun/handlers/tasks.ts` — new IPC handlers: `tasks.addLineComment`, `tasks.getLineComments`, `tasks.deleteLineComment`
- `src/bun/workflow/engine.ts` — `handleCodeReview` reads unsent decisions + line comments, enriches with diff content, marks as sent
- `src/bun/workflow/review.ts` — `formatReviewMessageForLLM` rewritten to emit annotated diff blocks with actual code content
- `src/shared/rpc-types.ts` — `LineComment` type; `CodeReviewFile` gains `lineComments`; `CodeReviewHunk` gains `originalLines` / `modifiedLines`
- `src/mainview/components/CodeReviewOverlay.vue` — remove `buildDisplayModel()`, `mapLineChangesToHunks()`, scroll-save/restore; add `deltaDecorations` for decided hunks; unified zone registry for hunks + line comments; line comment lifecycle
- `src/mainview/components/MonacoDiffEditor.vue` — glyph margin decoration, mouse-event handler, selection ContentWidget
- `src/mainview/components/LineCommentBar.vue` — new ViewZone component (open/posted states)
- `src/ui-tests/` — new or extended test file covering all scenarios
