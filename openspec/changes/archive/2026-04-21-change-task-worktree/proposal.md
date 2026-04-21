# Change Proposal: Manage Task Worktree from Info Tab

## Problem

The Worktree section in `TaskInfoTab` is read-only. Users cannot delete an existing worktree (without deleting the whole task) nor manually create one when none exists (e.g. after deletion, or before the card has left backlog).

## Goal

Give users full manual control over a task's worktree directly from the **Info tab** in the Task Detail drawer:

- **Delete** an existing worktree (with confirmation), without affecting the task itself
- **Create** a worktree when none exists, with full control over path, branch name, source branch (or existing branch)
- **Retry** creation when the worktree is in an error state

The automatic worktree creation on column transition (leaving backlog) is **preserved as-is**.

## Scope

### In scope
- Delete button on worktree path row (blocked while agent is running)
- Inline create form in TaskInfoTab when status is `not_created`, `removed`, or `error`
- Branch picker: new branch (name + source branch) or point to existing branch
- Path input pre-filled with auto-computed default, user-editable
- Retry button when status is `error`
- Three new RPC endpoints: `tasks.createWorktree`, `tasks.removeWorktree`, `tasks.listBranches`

### Out of scope
- Moving/renaming an existing worktree (delete + recreate is the intended flow)
- Editing the branch name of an existing worktree
- Any changes to the automatic worktree creation on task transition

## UI Design

### Worktree EXISTS (status: ready / creating)

```
┌──────────────────────────────────────────────────┐
│ WORKTREE                                         │
│  Branch  task/42-my-feature                      │
│  Path    /worktrees/task/42-my-feature   [🗑]    │
│  Status  ready                                   │
└──────────────────────────────────────────────────┘

  [🗑] = danger icon button, tooltip "Delete worktree"
  → disabled when executionState === 'running'
  → opens inline confirmation:
     "Delete worktree at /path/…? The task and branch will be kept."
     [Cancel]  [Delete]
```

### Worktree MISSING (status: not_created / removed)

```
┌──────────────────────────────────────────────────┐
│ WORKTREE                                         │
│  Status  not created                             │
│                                                  │
│  ○ New branch    ● Existing branch               │
│                                                  │
│  [New branch mode]                               │
│  Branch  [task/42-my-feature            ]        │
│  From    [main                         ▼]        │
│                                                  │
│  [Existing branch mode]                          │
│  Branch  [main                         ▼]        │
│                                                  │
│  Path    [/worktrees/task/42-my-feature ]        │
│          [       Create Worktree        ]        │
└──────────────────────────────────────────────────┘
```

### Worktree ERROR (status: error)

```
┌──────────────────────────────────────────────────┐
│ WORKTREE                                         │
│  Status  error                                   │
│          [Retry]                                 │
└──────────────────────────────────────────────────┘

  [Retry] expands the same create form, pre-filled with defaults.
```

## Behavior Rules

| Condition | Behavior |
|---|---|
| `executionState === 'running'` | Delete button disabled; create form hidden |
| `worktreeStatus === 'creating'` | Show spinner, no actions |
| `worktreeStatus === 'ready'` | Show delete button only |
| `worktreeStatus === 'not_created' / 'removed'` | Show create form |
| `worktreeStatus === 'error'` | Show error message + Retry button (opens create form) |
| Delete confirmed | Calls `tasks.removeWorktree`, task stays on board, status → `removed` |
| Create confirmed | Calls `tasks.createWorktree`, status → `creating` → `ready` (or `error`) |

## Data Model

No schema changes required. Existing `task_git_context` fields cover all cases:
- `worktree_status`: drives UI state
- `worktree_path`: updated on create
- `branch_name`: updated on create
- `base_sha`: captured after creation (HEAD of chosen branch/source)
- `git_root_path`: used to list branches and run git commands

When pointing to an **existing branch**, `base_sha` = HEAD of that branch at creation time. This is acceptable — diffs will show changes made after worktree creation.

## New RPC Endpoints

### `tasks.listBranches`
```
params: { taskId: number }
response: { branches: string[] }
```
Runs `git branch -a --format=%(refname:short)` in the task's `git_root_path`.

### `tasks.createWorktree`
```
params: {
  taskId: number
  path: string            // user-specified or default
  mode: 'new' | 'existing'
  branchName: string      // new branch name (mode=new) or existing branch (mode=existing)
  sourceBranch?: string   // only when mode=new
}
response: Task
```
- `mode=new`: runs `git worktree add -b <branchName> <path> <sourceBranch>`
- `mode=existing`: runs `git worktree add <path> <branchName>`
- Captures `base_sha` after creation
- Updates `task_git_context` and returns updated Task

### `tasks.removeWorktree`
```
params: { taskId: number }
response: { warning?: string }
```
Runs `git worktree remove --force <path>`, sets `worktree_status = 'removed'`. Task is unaffected.

## Files to Touch

| File | Change |
|---|---|
| `src/shared/rpc-types.ts` | Add 3 new RPC endpoint types |
| `src/bun/git/worktree.ts` | Extend `createWorktree()` to accept custom path/branch options; add `listBranches()` |
| `src/bun/handlers/tasks.ts` | Wire up `tasks.createWorktree`, `tasks.removeWorktree`, `tasks.listBranches` |
| `src/mainview/components/TaskInfoTab.vue` | Full worktree section redesign |
