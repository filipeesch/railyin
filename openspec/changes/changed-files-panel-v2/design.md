## Context

This change builds on `code-review-ux-overhaul` (implemented). The `ChangedFilesPanel` component and its backing handlers already exist. The core gap is that `git diff HEAD` is empty after the agent commits, so the panel disappears. All decisions here are additive — no existing review flow is broken.

---

## Decision 1: `base_sha` — where to store it

**Chosen:** Add a `base_sha TEXT` column to `task_git_context`. Populate it in `createWorktree()` immediately after `git worktree add` by running `git rev-parse HEAD` in the new worktree. The worktree is branched from `HEAD`, so this SHA is the exact fork point.

**Why not a separate table:** `task_git_context` is already the single source of truth for a task's worktree metadata. Adding one column is simpler and avoids an extra JOIN everywhere.

**Why not capture it later:** Later, the agent will commit on top of this SHA. Once it commits, `HEAD` in the worktree advances and we'd need `git merge-base` gymnastics. Capturing at worktree creation is deterministic.

---

## Decision 2: Diff range — `base_sha..HEAD` everywhere

**Chosen:** Replace `git diff HEAD` / `git diff HEAD --name-only` / `git diff HEAD --numstat` with `git diff <base_sha> HEAD` (or `<base_sha>..HEAD` — equivalent for two-dot range). For the `getChangedFiles` untracked file path, no change needed — untracked files aren't in git history.

**Special case — new (untracked) files:** `git diff base_sha HEAD` won't show untracked files. Keep the existing `git ls-files --others --exclude-standard` branch in `getChangedFiles`. For `getGitStat`, untracked files return `+N -0` stats via `wc -l`.

**Special case — `base_sha` is null (pre-migration worktrees):** Fall back to `git diff HEAD` for backwards compatibility. This preserves existing behaviour for worktrees created before this change lands.

**`getFileDiff` / `rejectHunk`:** These already use a `checkpointRef` parameter as the "from" SHA. When no checkpoint exists, they should fall back to `base_sha` rather than `HEAD`. This ensures even committed changes are diffable from the overlay.

---

## Decision 3: Remove All/Pending toggle — two-state panel

**State A — pending hunks exist:**
```
┌──────────────────────────────────────────────┐
│ Changes  [Accept All] [Reject All]  [Review] │
├──────────────────────────────────────────────┤
│ ▸ feature-b.vue      1 pending               │
│ ▸ partial-x.ts       3 pending               │
│ ▸ partial-y.ts       2 pending               │
└──────────────────────────────────────────────┘
```
- Shows only files with ≥ 1 pending hunk.
- "Accept All" / "Reject All": call new RPC `tasks.decideAllHunks` with `decision: "accepted" | "rejected"`.
- "Review": opens `CodeReviewOverlay`.
- File rows are collapsed by default (as implemented), expand on click.

**State B — all hunks decided (or no hunks at all):**
```
┌──────────────────────────────────────────────┐
│ Changes  ✓ All reviewed       [View Changes] │
└──────────────────────────────────────────────┘
```
- File list is hidden; single summary row shown.
- "View Changes": opens `CodeReviewOverlay` in read-only/changes mode so user can inspect what was accepted.

**Transition:** Panel reacts to `getGitStat` + `getChangedFiles` + hunk decision store. When the last pending hunk is decided (by Accept All, Reject All, or per-hunk in the overlay), the panel transitions to State B automatically.

---

## Decision 4: `tasks.decideAllHunks` RPC

**Chosen:** New backend handler that:
1. Fetches all changed files for the task (using `base_sha` range).
2. For each file, computes current diff hunks via `readFileDiffContent`.
3. For each hunk, upserts a row in `task_hunk_decisions` with the given decision (`accepted` or `rejected`).
4. Returns `{ decided: number }` — count of hunks that were actually updated.

**Why not call `tasks.acceptHunk` / `tasks.rejectHunk` per-hunk from the frontend:** Round-trip per hunk would be O(N) RPCs. One bulk RPC is simpler, faster, and atomic from the UI's perspective.

---

## Decision 5: Frontend panel state logic

**Chosen:** In `ChangedFilesPanel.vue`:
- Replace the `showAll` / `showPending` toggle `ref` with a single `hasPendingHunks` computed derived from the `reviewStore`.
- `hasPendingHunks` is `true` if any file in `reviewStore.files` has `pendingCount > 0`.
- Template branches on `hasPendingHunks` for State A vs State B layout.
- "Accept All" and "Reject All" buttons call `decideAllHunks` then re-fetch stats.

**Dark theme:** All existing hardcoded colour fallbacks remain removed (done in previous session). The two new buttons use the same `ghost`-style token pattern as "Review" button already uses.

---

## Data Flow

```
createWorktree()
  └─ git rev-parse HEAD → base_sha → task_git_context.base_sha

getGitStat(taskId)
  └─ SELECT base_sha FROM task_git_context
  └─ git diff <base_sha> HEAD --numstat  (or HEAD if base_sha null)
  └─ git ls-files --others for untracked

getChangedFiles(taskId)
  └─ SELECT base_sha FROM task_git_context
  └─ git diff <base_sha> HEAD --name-only  +  git ls-files --others

getFileDiff(taskId, filePath, checkpointRef?)
  └─ checkpointRef → base_sha → HEAD  (fallback chain)

decideAllHunks(taskId, decision)
  └─ getChangedFiles → for each file readFileDiffContent
  └─ for each hunk: upsert task_hunk_decisions

ChangedFilesPanel.vue
  └─ hasPendingHunks ← reviewStore.files[*].pendingCount
  └─ State A: pending list + Accept All / Reject All / Review
  └─ State B: summary + View Changes
```
