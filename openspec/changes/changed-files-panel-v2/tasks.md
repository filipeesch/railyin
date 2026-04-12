## 1. DB Migration

- [ ] 1.1 Add a new migration entry in `src/bun/db/migrations.ts`:
  `ALTER TABLE task_git_context ADD COLUMN base_sha TEXT`
  Use the next available migration `id` string (follow the existing `{ id, sql }` pattern).

## 2. Backend: Capture `base_sha` at worktree creation

- [ ] 2.1 In `src/bun/git/worktree.ts`, in `createWorktree()`, after the `git worktree add` proc succeeds (exit code 0):
  - Run `git rev-parse HEAD` in `worktreePath` to get the base SHA.
  - Capture stdout, trim.
  - Update the `UPDATE task_git_context SET worktree_status = 'ready'` query to also set `base_sha = ?`.
  - If `git rev-parse HEAD` fails for any reason, log a warning and proceed without setting `base_sha` (leave NULL — backwards compatibility fallback).

## 3. Backend: Use `base_sha` in diff handlers

- [ ] 3.1 In `tasks.getGitStat` (`src/bun/handlers/tasks.ts`):
  - Change the SELECT to `SELECT worktree_path, worktree_status, base_sha FROM task_git_context WHERE task_id = ?`.
  - Replace `git diff --numstat HEAD` with `git diff --numstat <base_sha> HEAD` when `base_sha` is non-null, falling back to `git diff --numstat HEAD` when null.
  - For untracked files (not shown by `git diff`): keep existing `git ls-files --others` logic and count their lines via `wc -l` or line split, adding them to the result as `additions: lineCount, deletions: 0`.

- [ ] 3.2 In `tasks.getChangedFiles` (`src/bun/handlers/tasks.ts`):
  - Change the SELECT to also fetch `base_sha`.
  - Replace `git diff HEAD --name-only --diff-filter=ACDMR` with `git diff <base_sha> HEAD --name-only --diff-filter=ACDMR` when `base_sha` is non-null.
  - Keep untracked `git ls-files --others --exclude-standard` branch unchanged.

- [ ] 3.3 In `readFileDiffContent` (the internal helper called by `tasks.getFileDiff` and `tasks.rejectHunk`):
  - Find the fallback that runs `git diff HEAD -- <file>`.
  - Change it to: when `base_sha` is available, use `git diff <base_sha> HEAD -- <file>` instead.
  - Pass `base_sha` through from the handler query (either extend the helper signature or fetch it inside the helper).

## 4. Backend: `tasks.decideAllHunks` RPC

- [ ] 4.1 Add `tasks.decideAllHunks` to `src/shared/rpc-types.ts`:
  - Params: `{ taskId: number; decision: "accepted" | "rejected" }`
  - Response: `{ decided: number }`

- [ ] 4.2 Implement `tasks.decideAllHunks` handler in `src/bun/handlers/tasks.ts`:
  - Fetch all changed files via `getChangedFiles` logic (or reuse internal helper directly).
  - For each file, call `readFileDiffContent` to get current hunks.
  - For each hunk, upsert into `task_hunk_decisions`:
    `INSERT INTO task_hunk_decisions (...) VALUES (...) ON CONFLICT(task_id, hunk_hash, reviewer_id) DO UPDATE SET decision = ?, updated_at = datetime('now')`
  - Only update hunks whose current decision is `'pending'` (skip already-decided hunks).
  - Return `{ decided: N }`.

## 5. Frontend: Remove toggle, add two-state panel

- [ ] 5.1 In `src/mainview/components/ChangedFilesPanel.vue`:
  - Remove the `showAll` / `showPending` toggle `ref` and any associated toggle button from the template.
  - Add `hasPendingHunks` computed: `reviewStore.files.some(f => f.pendingCount > 0)`.
  - Branch the template on `hasPendingHunks`:
    - **State A (pending)**: Show file list filtered to files with `pendingCount > 0`; show "Accept All", "Reject All", and "Review" buttons in the header.
    - **State B (all decided)**: Hide file list; show a single summary line "✓ All reviewed" + a "View Changes" button that opens `CodeReviewOverlay`.
  - "Accept All" and "Reject All" call `tasks.decideAllHunks` with the appropriate decision, then trigger a stats refresh.
  - Dark theme: both new buttons must use `background: transparent` and follow the same CSS token pattern as the existing "Review" button.

- [ ] 5.2 Remove the `getChangedFiles` polling that was powering the "All" tab (if any frontend polling exists solely for the toggle).
  Keep any polling that feeds `reviewStore` / pending counts — that stays.

## 6. Test coverage

- [ ] 6.1 Add a backend unit test in `src/bun/test/` that:
  - Creates a temp git repo, makes a commit (establishing `base_sha`), then makes a second commit.
  - Calls `getGitStat` and `getChangedFiles` and asserts they return data from the second commit range (not empty).
  - Verifies the same calls return null/[] when there are no changes after `base_sha`.

- [ ] 6.2 In `src/ui-tests/review-overlay.test.ts` (or a new file), add a UI test for `tasks.decideAllHunks`:
  - Seed test env, open panel, call Accept All, assert `reviewStore.files` pendingCounts all become 0.
  - Assert panel transitions to State B.
