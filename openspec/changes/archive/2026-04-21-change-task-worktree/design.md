## Context

The `task_git_context` table already holds all required fields (`worktree_path`, `worktree_status`, `branch_name`, `base_sha`, `git_root_path`). The existing `createWorktree()` function in `src/bun/git/worktree.ts` auto-computes branch name and path from the task title — it cannot accept user-supplied values. `removeWorktree()` already exists but is only called from the task deletion flow.

The frontend `TaskInfoTab.vue` is currently read-only. The `TaskDetailDrawer.vue` already has the Dialog + confirm-delete pattern to reference for the delete confirmation.

## Goals / Non-Goals

**Goals:**
- Expose `removeWorktree` as a standalone RPC action (independent of task deletion)
- Extend `createWorktree` to accept a custom path, branch name, source branch, or existing branch
- Add `listBranches` RPC to populate branch pickers in the UI
- Redesign the Worktree section in `TaskInfoTab.vue` to be fully interactive based on `worktreeStatus`
- Block all destructive actions when `executionState === 'running'`

**Non-Goals:**
- `git worktree move` — moving an existing worktree without delete/recreate
- Editing branch name of an existing ready worktree
- Changes to auto-creation on column transition

## Decisions

### D-1: Extend `createWorktree()` rather than add a new function

`createWorktree(taskId)` currently computes branch + path and runs `git worktree add`. Instead of duplicating the function, add an optional `options` parameter:

```ts
createWorktree(taskId, options?: {
  path?: string;        // override computed default
  mode: 'new' | 'existing';
  branchName: string;
  sourceBranch?: string; // only for mode='new'
})
```

When `options` is provided, skip the auto-computation and use user-supplied values. When absent (called from `triggerWorktreeIfNeeded`), behavior is unchanged.

**Why not a separate function?** The `base_sha` capture, status transitions (`creating` → `ready`/`error`), and error handling logic is identical. A single parameterized function avoids drift.

### D-2: `tasks.removeWorktree` is a new standalone endpoint

Currently `removeWorktree()` is called inside `tasks.delete`. We expose it as `tasks.removeWorktree` separately — the handler calls the same `removeWorktree()` utility and sets `worktree_status = 'removed'`. The task row itself is untouched.

This means after a manual removal, the task stays on the board in whatever column it was in. The auto-create trigger (`triggerWorktreeIfNeeded`) will re-create it if the task transitions again from backlog — this is acceptable since `removed` is treated the same as `error` in the trigger guard.

**Update:** `triggerWorktreeIfNeeded` currently only retries on `not_created | error`. It must also include `removed` so a user who deleted and moved the card again gets a fresh worktree.

### D-3: `tasks.listBranches` uses `git branch -a --format=%(refname:short)`

Lists both local and remote-tracking branches. Remote refs like `origin/main` are included — this is useful when the user wants to base a new branch on a remote that isn't checked out locally.

The response is `{ branches: string[] }` — a flat sorted list. Filtering (e.g. stripping `HEAD` symbolic ref) happens in the handler.

### D-4: Inline UI, no modal for the create form

The create form expands inline within the Worktree section of `TaskInfoTab`. The delete confirmation is also inline (replaces the path row with a confirm/cancel prompt), matching the proposal's design. This avoids layering a modal on top of the drawer.

The `TaskInfoTab` component receives new emits: `createWorktree(params)` and `removeWorktree()` — actual API calls happen in `TaskDetailDrawer` to keep async state management centralized.

**Why emit up instead of calling the API in TaskInfoTab?** `TaskDetailDrawer` already manages loading states and WS-driven task updates. Keeping API calls there avoids duplicating that infrastructure and keeps `TaskInfoTab` as a pure presentation component.

### D-5: `base_sha` for existing-branch mode

When `mode='existing'`, the worktree checks out an existing branch. `base_sha` is set to `HEAD` of that branch at creation time. This means the diff view will show only changes made _after_ the worktree was created, not the full branch history. This is the accepted trade-off — the proposal explicitly acknowledges it.

## Risks / Trade-offs

- **`removed` status not retried on transition** → Fixed in D-2: update `triggerWorktreeIfNeeded` to also retry on `removed`.
- **Race: user deletes worktree while agent finishes a turn** → Blocked at UI level (delete disabled while `executionState === 'running'`). The backend does not add an extra guard since the running check is authoritative in the frontend.
- **`git branch -a` can be slow on large repos** → The branch list is fetched once when the create form opens (not on every render). Acceptable for the use case.
- **Existing worktree at custom path conflicts with another task** → `git worktree add` will fail; the error is surfaced as `worktree_status = 'error'` and the error message shown in the UI.

## Migration Plan

No database schema changes. No config changes. The `triggerWorktreeIfNeeded` change is backward-compatible — tasks with `removed` status that have never re-transitioned were previously left in limbo; now they get a fresh worktree on next transition (same behavior as `error`).

Deployment: ship as a single release. No rollback concerns beyond reverting the release.

## Open Questions

- Should `tasks.listBranches` cache the branch list for the duration of the drawer session, or always fetch fresh? Current decision: always fresh (called once on form open). Can revisit if latency is a complaint.
