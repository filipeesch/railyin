## 1. Shared Types & RPC

- [x] 1.1 Add `"code_review"` to `MessageType` union in `src/shared/rpc-types.ts`
- [x] 1.2 Add `CodeReviewPayload`, `CodeReviewFile`, and `CodeReviewHunk` types to `src/shared/rpc-types.ts`
- [x] 1.3 Add `tasks.getChangedFiles` RPC signature to `src/shared/rpc-types.ts`
- [x] 1.4 Add `tasks.getFileDiff` RPC signature to `src/shared/rpc-types.ts`
- [x] 1.5 Add `tasks.rejectHunk` RPC signature to `src/shared/rpc-types.ts`

## 2. Backend — RPC Handlers

- [x] 2.1 Implement `tasks.getChangedFiles` in `src/bun/handlers/tasks.ts` — runs `git diff HEAD --name-only --diff-filter=ACDMR` in the task worktree and returns `string[]`
- [x] 2.2 Implement `tasks.getFileDiff` in `src/bun/handlers/tasks.ts` — runs `git show HEAD:<path>` for original and reads worktree file for modified; handles new and deleted files
- [x] 2.3 Implement `tasks.rejectHunk` in `src/bun/handlers/tasks.ts` — parses `git diff HEAD <filePath>`, extracts hunk at index, generates inverse patch, applies with `git apply --reverse --whitespace=fix`, returns updated `{ original, modified }`
- [x] 2.4 Exclude `"code_review"` messages from `compactMessages` in `src/bun/workflow/engine.ts`
- [x] 2.5 Handle `tasks.sendMessage` with `code_review` payload — store the `"code_review"` conversation message, inject plain-text user-role message to LLM, and trigger new execution in the current column

## 3. Backend — Review Message Formatting

- [x] 3.1 Implement `formatReviewMessageForLLM(payload: CodeReviewPayload): string` utility — produces the structured plain-text message with ❌ REJECTED and 📝 CHANGE REQUESTED sections (only actionable items; accepted hunks omitted)
- [x] 3.2 Use default text "The user explicitly rejected this change." for rejected hunks with no comment

## 4. Frontend — Pinia Store

- [x] 4.1 Create `src/mainview/stores/review.ts` — holds `ReviewSession` state: `taskId`, per-file hunk decisions (`accepted | rejected | change_request | pending`), and comments
- [x] 4.2 Add actions: `setDecision(filePath, hunkIndex, decision, comment?)`, `resetSession()`, `getSubmitPayload()` (excludes accepted/pending hunks)
- [x] 4.3 Add computed: `canSubmit` (false if any change_request hunk has no comment), `pendingCount`, `fileAggregateState(filePath)`

## 5. Frontend — Changed Files Badge

- [x] 5.1 Add `changedFileCount` state to the task store, populated by calling `tasks.getChangedFiles` on `file_diff` IPC events and on `task.updated` with `executionState: "completed"`
- [x] 5.2 Add changed-files badge to `TaskCard.vue` — shows count, visible in any column; clicking opens the review overlay for that task
- [x] 5.3 Add changed-files badge to the task detail drawer header — shows count; clicking opens the review overlay

## 6. Frontend — Monaco Integration

- [x] 6.1 Add `@monaco-editor/loader` dependency to `package.json`
- [x] 6.2 Create `src/mainview/components/MonacoDiffEditor.vue` — lazy-loads Monaco on first mount, creates a `DiffEditor` with `renderSideBySide: true`, accepts `{ original: string, modified: string, language: string }` props, emits `lineChanges` when Monaco computes its diff

## 7. Frontend — Review Overlay

- [x] 7.1 Create `src/mainview/components/CodeReviewOverlay.vue` — full-screen overlay, fetches changed files on open, renders `ReviewFileList` and `MonacoDiffEditor` side by side
- [x] 7.2 Create `src/mainview/components/ReviewFileList.vue` — scrollable file list panel showing filename, aggregate decision indicator (⬜ ✅ ❌ 📝) per file; handles file selection
- [x] 7.3 Implement hunk action bar as a Monaco view zone below each `ILineChange` — renders Accept, Reject, and Change Request buttons with optional comment textarea
- [x] 7.4 Wire Accept button: set hunk to `accepted` in review store; no backend call
- [x] 7.5 Wire Reject button: call `tasks.rejectHunk`, on success set hunk to `rejected` in store, call `tasks.getChangedFiles` to refresh badge count, reset Monaco models with returned `{ original, modified }`
- [x] 7.6 Wire Change Request button: require non-empty comment before saving; set hunk to `change_request` in store
- [x] 7.7 Implement Submit Review button — disabled when `!reviewStore.canSubmit`; shows "(N undecided)" warning when `reviewStore.pendingCount > 0`; on click calls `tasks.sendMessage` with `CodeReviewPayload` and closes overlay
- [x] 7.8 Add Refresh button to overlay header — re-calls `tasks.getChangedFiles` and re-fetches the active file's diff
- [x] 7.9 Handle `tasks.rejectHunk` error — show inline error message "Could not revert this hunk — the file has been modified manually." with a Reload button

## 8. Frontend — Code Review Message in Conversation

- [x] 8.1 Add `code_review` case to the conversation timeline renderer in the task detail drawer — render a `CodeReviewCard` instead of `MessageBubble`
- [x] 8.2 Create `src/mainview/components/CodeReviewCard.vue` — collapsible card showing decision summary (N rejected, N change_requested, N accepted); expands to show per-file and per-hunk details with comments

## 9. Tests

- [x] 9.1 Unit test `tasks.getChangedFiles` — clean worktree returns `[]`, changed worktree returns file paths
- [x] 9.2 Unit test `tasks.getFileDiff` — new file, deleted file, modified file
- [x] 9.3 Unit test `tasks.rejectHunk` — successful revert, conflict error case
- [x] 9.4 Unit test `formatReviewMessageForLLM` — accepted-only payload produces minimal message, mixed payload includes only rejected and change_request items with correct comments and defaults
- [x] 9.5 Unit test `compactMessages` — `code_review` messages are excluded from LLM output

## 10. Persistent Hunk Decisions (Architecture Revision)

### 10.1 — DB Migration

- [x] 10.1 Add migration `004_hunk_decisions` to `src/bun/db/migrations.ts` — creates `task_hunk_decisions` table with `PRIMARY KEY (task_id, hunk_hash, reviewer_id)`, columns: `file_path`, `reviewer_type` (`'human'|'ai'`), `reviewer_id` (default `'user'`), `decision`, `comment`, `original_start`, `modified_start`, `created_at`, `updated_at`

### 10.2 — Shared Types

- [x] 10.2 Add `HunkWithDecisions`, `ReviewerDecision` types to `src/shared/rpc-types.ts`
- [x] 10.3 Add `tasks.setHunkDecision` RPC signature: `{ taskId, hunkHash, filePath, decision, comment, originalStart, modifiedStart } → void`
- [x] 10.4 Update `tasks.getFileDiff` response type to return `{ original, modified, hunks: HunkWithDecisions[] }` instead of `{ original, modified }`

### 10.3 — Backend: hash computation + new RPC

- [x] 10.5 Add `computeHunkHash(filePath, originalLines, modifiedLines): string` helper in `src/bun/handlers/tasks.ts` using `crypto.createHash('sha256')`
- [x] 10.6 Implement `tasks.setHunkDecision` handler — upserts a row in `task_hunk_decisions` with `reviewer_type: 'human'`, `reviewer_id: 'user'`; updates `updated_at`
- [x] 10.7 Update `tasks.getFileDiff` handler — after fetching `original`/`modified`, run `git diff HEAD -- <file>`, parse `@@` hunks to extract per-hunk line ranges and content, compute hash per hunk, join with `task_hunk_decisions` for `reviewer_id = 'user'`, return enriched `HunkWithDecisions[]`
- [x] 10.8 Update `tasks.rejectHunk` — after applying inverse patch, also call the DB upsert logic to store `decision: 'rejected'` for that hunk hash

### 10.4 — Backend: submit reads from DB

- [x] 10.9 Update `handleCodeReview` in `engine.ts` — instead of receiving `payload` from the frontend, query `task_hunk_decisions` for the task (human reviewer only), build `CodeReviewPayload` from DB rows, pass to `formatReviewMessageForLLM`
- [x] 10.10 Update `tasks.sendMessage` code_review path — `parsed.payload` is no longer required in the JSON envelope; `{ _type: "code_review" }` is sufficient to trigger a review submission

### 10.5 — Frontend: thin store

- [x] 10.11 Replace `src/mainview/stores/review.ts` — remove all decision/hunk state; keep only `isOpen`, `mode` (`'changes'|'review'`), `selectedFile`, `filter` (`'all'|'unreviewed'|'needs_action'|'accepted'`), `taskId`, `files`; add `optimisticUpdates: Map<string, {decision, comment}>` for in-flight writes
- [x] 10.12 Remove `initFileHunks`, `setDecision`, `getSubmitPayload`, `canSubmit`, `pendingCount`, `fileAggregateState` from the Pinia store

### 10.6 — Frontend: overlay refactor

- [x] 10.13 Refactor `CodeReviewOverlay.vue` — default mode is `'changes'` (read-only); decisions loaded from `tasks.getFileDiff` response `hunks[].decisions`; hunk action bars inactive in changes mode, show decision badge only
- [x] 10.14 Add **"Start Review"** button to overlay header — switches `reviewStore.mode` to `'review'`; action bars become interactive
- [x] 10.15 Add filter dropdown (All / Unreviewed / Needs Action / Accepted) to overlay header — filters file list and hunk list
- [x] 10.16 Wire hunk decisions to `tasks.setHunkDecision` — on Accept/Reject/ChangeRequest, write optimistic update to store, call RPC, clear optimistic on success (or revert on error)
- [x] 10.17 On submit: call `tasks.sendMessage({ taskId, content: JSON.stringify({ _type: "code_review" }) })` — no payload in envelope; backend reads from DB
- [x] 10.18 Update `canSubmit` and `pendingCount` — computed from `hunks[].decisions` returned by `tasks.getFileDiff` (not Pinia store); `canSubmit` is false if any human change_request hunk has no comment

### 10.7 — Tests

- [x] 10.19 Unit test `tasks.setHunkDecision` — creates row, upserts on second call, updates `updated_at`
- [x] 10.20 Unit test `tasks.getFileDiff` hunk enrichment — returns `HunkWithDecisions[]` with decisions joined from DB; new hunk without prior decision returns `decision: 'pending'`
- [x] 10.21 Unit test `handleCodeReview` reads from DB — verify that submitting `{ _type: "code_review" }` compiles payload from `task_hunk_decisions` rows, not from request body

### 10.8 — UX polish

- [x] 10.22 Add sync/refresh button to task detail drawer header — always visible when a task is open; calls `taskStore.refreshChangedFiles` to update the changed-files count without opening the overlay
- [x] 10.23 Auto-refresh changed-files count when the drawer opens for a task with `worktreeStatus: 'ready'`

