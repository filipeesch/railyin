## Context

Railyin tasks each run in an isolated git worktree on a dedicated branch (`task/{id}-{slug}`). The model makes file changes via `write_file`, `patch_file`, `delete_file`, and `rename_file` tools — each producing a `FileDiffPayload` stored as a `"file_diff"` message in the conversation. These per-tool-call diffs are already rendered inline in the conversation via `FileDiff.vue`.

The existing `tasks.getGitStat` RPC runs `git diff --stat HEAD` and returns a text summary shown in the task detail side panel. There is no structured way to get the full diff, no mechanism to accept or reject changes, and no way to send structured review feedback to the model.

The `run_command` tool is read-only by enforcement (blocks `rm`, `mv`, `cp`, `>`, `>>`, `tee`, etc.), so all file changes in the worktree come exclusively from tracked write tools — unless the user edits the worktree manually.

## Goals / Non-Goals

**Goals:**
- Show a "changed files" badge on task cards and in the task detail drawer whenever the worktree has uncommitted changes
- Provide a full-screen Monaco-based side-by-side diff review overlay for all changed files
- Support per-hunk decisions: Accept (no-op), Reject (immediate worktree revert), Change Request (keep code, require a fix comment)
- Send a structured `"code_review"` message to the model in the current column with its existing toolset
- Persist the review message in conversation history (excluded from LLM compaction)
- Work in any column — the review surface is column-agnostic

**Non-Goals:**
- Changing the task's column or toolset as part of the review flow
- Line-level comments (hunk-level is the granularity)
- Reviewing changes not tracked by git (e.g., untracked files not yet `git add`ed)
- Real-time collaboration / multi-reviewer (but schema is designed to support it in the future)
- AI reviewer triggering (future capability — schema is ready, no UI planned in this change)

## Decisions

### D1: Use Monaco DiffEditor for side-by-side view

**Decision**: Use `@monaco-editor/loader` (lazy-loaded) to render a `monaco.editor.createDiffEditor` per file in the review overlay.

**Rationale**: Monaco's `DiffEditor` gives side-by-side alignment, syntax highlighting, and `getLineChanges()` out of the box. The `ILineChange[]` array maps directly to git hunk coordinates needed for revert. Building a custom side-by-side component would replicate ~80% of Monaco with worse fidelity. In an Electrobun desktop app, the ~5–10 MB bundle cost is acceptable.

**Alternative considered**: Custom Vue unified diff component (extending `FileDiff.vue`). Rejected because it doesn't provide side-by-side alignment or hunk coordinate extraction without significant effort.

### D2: Canonical diff source is `git diff HEAD` on review open

**Decision**: When the review overlay opens, fetch the full diff via a new `tasks.getFileDiff(taskId, filePath)` RPC that runs `git show HEAD:<path>` (original) and reads the worktree file (modified). These two strings are fed to Monaco's DiffEditor.

**Rationale**: `git diff HEAD` is the authoritative source — it consolidates multiple tool-call writes to the same file into a single coherent diff, catches manual user edits, and ignores intermediate write_file calls that were subsequently overwritten. Per-tool-call `file_diff` messages remain in the conversation for history but are not used as the review source.

**Alternative considered**: Using stored `FileDiffPayload` objects from `file_diff` messages. Rejected because the same file can be written multiple times, the hunks don't compose cleanly, and manual edits are invisible.

### D3: Changed-files badge driven by new `tasks.getChangedFiles` RPC

**Decision**: New RPC `tasks.getChangedFiles(taskId) → string[]` runs `git diff HEAD --name-only --diff-filter=ACDMR` in the worktree. The frontend calls this when:
1. A `file_diff` IPC message arrives for the task
2. A `task.updated` event arrives with `executionState: "completed"`
3. The review overlay closes after a revert

**Rationale**: Badge accuracy matters. Using the count of `file_diff` messages in the conversation would double-count multiple writes to the same file and miss manual edits. `git diff HEAD` is the ground truth.

### D4: Reject immediately via hunk-index, not full patch reconstruction

**Decision**: New RPC `tasks.rejectHunk(taskId, filePath, hunkIndex)` on the backend:
1. Runs `git diff HEAD <filePath>` to get the current diff
2. Parses it to extract hunk at `hunkIndex`
3. Generates the inverse patch string (swap `+`/`-`, adjust header)
4. Applies with `git apply --reverse --whitespace=fix`
5. Returns the new file content (or triggers a re-fetch)

After revert, the frontend re-fetches `tasks.getFileDiff` for that file and resets Monaco's modified model value. Monaco recomputes `getLineChanges()` — hunk indices shift automatically.

**Rationale**: Immediate revert (not batched on submit) matches Cursor and Copilot UX. Hunk-index is stable enough because we re-fetch after each revert, so stale indices are never acted on. Using `git apply --reverse` is the standard approach and handles context validation.

**Alternative considered**: Reverting the entire file (`git checkout HEAD -- <path>`). Rejected for hunk-level granularity — the user may want to accept some hunks and reject others in the same file.

### D5: Submit as `"code_review"` MessageType in current conversation

**Decision**: Submitting the review creates a new `ConversationMessage` with `type: "code_review"` and JSON content. This message is stored in the DB and delivered to the frontend via `message.new`. It is excluded from `compactMessages()` for LLM context assembly — instead, a human-readable summary is injected as a `"user"` role message to the model.

**The model receives a plain-text user message structured as:**
```
=== Code Review ===

❌ REJECTED — already reverted in your worktree:
  • src/bun/workflow/tools.ts, hunk at lines 45–67
    → "Restore the original Myers diff."

📝 CHANGE REQUESTED — code kept, apply these fixes:
  • src/shared/rpc-types.ts, hunk at lines 89–95
    → "Rename TaskRow → TaskRecord for consistency."

Please address all rejected and change-requested items.
```

**Rationale**: The model only needs to act on rejected and change-requested items. Accepted changes are not included. Rejected hunks have already been reverted in the worktree, so the model rewrites from a clean slate. The `"code_review"` message type in the DB allows the UI to render it distinctly (as a review summary card) while the actual LLM payload is a standard user message.

### D6: Three hunk decision states

**Decision**: `"accepted" | "rejected" | "change_request"` with the following rules:
- Accepted: no-op, not in submit message
- Rejected: immediate revert, comment optional (default: "The user explicitly rejected this change.")
- Change Request: no revert, comment **required** before saving the decision
- Undecided hunks on submit: implicitly accepted, submit button shows "(N undecided)" warning

**Rationale**: accepted/rejected are clear binary states. "Change request" handles the common case where code direction is correct but needs a targeted fix (rename, extract, adjust). Requiring a comment on change_request prevents meaningless "please fix this" messages to the model.

### D7: Review state persisted in SQLite via content-hash identity

**Decision**: Hunk decisions are persisted in a new `task_hunk_decisions` table in SQLite. Each hunk is identified by a content hash: `SHA-256(filePath + "\0" + originalLines + "\0" + modifiedLines)`. Decisions are written immediately on user action (not batched on submit). On submit, the backend reads decisions from DB.

**Rationale**: Transient Pinia-only state is lost on overlay close, column change, or app restart. Persisting to DB means decisions survive across sessions. The content-hash identity means:
- If the model makes the same change again → prior decision is restored (e.g., previously accepted)
- If the model changes the code → new hash → starts as "pending" (clearing is free)
- No explicit "clear decisions" action needed

**Carries-over rule**: Decisions carry over across executions. If the model reproduced the exact same diff content, the prior human decision is still valid.

**Alternative considered**: Pinia-only with localStorage backup. Rejected because localStorage is not the right persistence layer for structured relational data with per-task scope.

### D8: `task_hunk_decisions` table supports multiple reviewers

**Decision**: The table has a `reviewer_id` axis (PRIMARY KEY is `(task_id, hunk_hash, reviewer_id)`). For human reviews, `reviewer_type = 'human'` and `reviewer_id = 'user'`. Future AI reviewers write with `reviewer_type = 'ai'` and `reviewer_id = '<model-name>'`.

**Schema:**
```sql
CREATE TABLE task_hunk_decisions (
  task_id        INTEGER NOT NULL REFERENCES tasks(id),
  hunk_hash      TEXT    NOT NULL,
  file_path      TEXT    NOT NULL,
  reviewer_type  TEXT    NOT NULL DEFAULT 'human',
  reviewer_id    TEXT    NOT NULL DEFAULT 'user',
  decision       TEXT    NOT NULL DEFAULT 'pending',
  comment        TEXT,
  original_start INTEGER NOT NULL,
  modified_start INTEGER NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, hunk_hash, reviewer_id)
);
```

**Rationale**: The schema is ready for a future `AI Review` tool that calls `tasks.setHunkDecision` with its model name as `reviewer_id`. The overlay can render AI decisions as advisory annotations alongside human decisions. Keeping `reviewer_id = 'user'` for humans gives a clean upgrade path to multi-user without breaking the schema.

### D9: Two surface modes — Changes view and Review mode

**Decision**: The overlay opens in **Changes mode** (read-only) by default. A **"Start Review"** button switches to **Review mode** where hunk action bars become interactive and a Submit button appears.

**Changes mode:**
- Monaco diff is read-only
- Decisions shown as badges (⬜ ✅ ❌ 📝) loaded from DB
- AI reviewer suggestions shown as annotations (future)
- Filter dropdown: All / Unreviewed / Needs Action / Accepted
- Sync button to refresh from `git diff HEAD`

**Review mode:**
- Monaco diff is read-only (content never edited, only accepted/rejected)
- Hunk action bars interactive: Accept / Reject / Change Request
- Each decision writes immediately to DB via `tasks.setHunkDecision`
- Submit compiles decisions from DB and sends to model

**Rationale**: Most of the time the user wants to browse changes, not do a full review. Separating modes prevents accidental decision changes when just browsing. Badge clicks open Changes mode, not Review mode.

### D10: Pinia store is pure UI state; DB is source of truth for decisions

**Decision**: The Pinia `reviewStore` no longer holds hunk decisions. It holds only:
- `isOpen: boolean`
- `mode: 'changes' | 'review'`
- `selectedFile: string | null`
- `filter: 'all' | 'unreviewed' | 'needs_action' | 'accepted'`
- `optimisticUpdates: Map<hash, {decision, comment}>` (in-flight, discarded when RPC resolves)

Hunk decisions come from the `tasks.getFileDiff` response (which now includes pre-joined decisions from DB). `tasks.setHunkDecision` updates DB immediately on each decision change.

**Rationale**: Single source of truth simplifies correctness. Optimistic updates prevent UI lag on each keypress without sacrificing consistency.

## Risks / Trade-offs

**R1: Monaco bundle size (~5–10 MB)**
→ Lazy-load Monaco only when the review overlay first opens. Use `@monaco-editor/loader` with on-demand initialization. Users who never open the review panel pay zero cost.

**R2: Hunk revert conflicts**
→ If the worktree has unsaved manual changes that conflict with the inverse patch, `git apply --reverse` will fail. Return the error to the frontend and show a clear message: "Could not revert this hunk — the file has been modified manually. Edit manually or discard all changes." A "Reload" button re-fetches the current state.

**R3: Stale badge count**
→ The badge is refreshed on `file_diff` events and `task.updated` completed events. It will not auto-update if the user manually edits the worktree outside of Railyin. A **"Sync"** button in the overlay header always re-fetches from `git diff HEAD`. Badge click opens the Changes view directly.

**R4: Large diffs performance**
→ Monaco renders one file at a time. The file list is eager (all paths loaded on open), but Monaco editors are lazy — only the selected file is mounted. Files with >10,000 lines will show a Monaco warning; no special handling planned.

**R5: `code_review` message injected as user role triggers model execution**
→ When the review message is sent, the backend must trigger a new execution in the current column (same as `tasks.sendMessage` today). If the column has no write tools, the model can read and respond but cannot apply fixes. This is a known constraint of the column-agnostic design — the user is responsible for ensuring the task is in a writable column when submitting a review that requires code changes.

## Open Questions

- **Q1 (resolved)**: Submit triggers execution automatically — same as `tasks.sendMessage`. Decisions are read from DB at submit time.
- **Q2 (resolved)**: `"code_review"` messages render as a distinct collapsible card in the conversation timeline.
