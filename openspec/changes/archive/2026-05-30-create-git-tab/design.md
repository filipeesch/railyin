## Context

The task chat drawer currently has three tabs: Chat, Info, and Decisions. The Info tab hosts three concerns: project metadata, worktree management, and task description. Worktree management (branch, path, status, create/delete) is a git-specific concern that doesn't belong alongside a read-only description field.

The frontend follows a consistent two-layer component pattern for drawer tabs: a **smart panel** (e.g., `TaskInfoPanel.vue`) that owns API calls and state, and a **presentational tab** (e.g., `TaskInfoTab.vue`) that owns the template and styles. The `WorktreeCreateForm.vue` component is already self-contained and reusable.

## Goals / Non-Goals

**Goals:**
- Add a Git tab to the drawer toolbar (Chat | Info | Git | Decisions)
- Move worktree management from Info to the Git tab
- Simplify `TaskInfoTab` and `TaskInfoPanel` by removing all worktree-related code
- Fix the duplicate watcher in `TaskInfoPanel.vue`
- Follow the existing smart-panel + presentational-tab component pattern

**Non-Goals:**
- Adding new git views (log, status, diff, commit actions) — out of scope for this change
- Moving `ChangedFilesPanel` out of the Chat tab
- Any backend changes

## Decisions

### Two-file component pattern for the Git tab
`TaskGitPanel.vue` (smart container) + `TaskGitTab.vue` (presentational) mirrors the `TaskInfoPanel` / `TaskInfoTab` split exactly. This keeps API orchestration and template concerns in separate, independently testable files.

**Alternative considered**: single `TaskGitPanel.vue` containing both. Rejected — breaks the established pattern and mixes concerns.

### Tab order: Chat | Info | Git | Decisions
Git follows Info naturally (both are metadata-oriented), and Decisions stays last as it is used less frequently.

### Component responsibilities

**`TaskGitPanel.vue`** (smart container):
- Owns state: `branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning`
- Calls: `tasks.listBranches`, `tasks.createWorktree`, `tasks.removeWorktree`
- Watches `task.worktreeStatus` to trigger branch fetch
- Passes all data/loading/error down to `TaskGitTab` as props
- Handles the `TaskDetailOverlay` (edit dialog) — wait, that stays in `TaskInfoPanel`

**`TaskGitTab.vue`** (presentational):
- Template: worktree status states (ready / creating / error / not_created / removed)
- Receives props; emits `createWorktree`, `removeWorktree`
- Embeds `WorktreeCreateForm` inline (no change to that component)

**`TaskInfoPanel.vue`** (after cleanup):
- Drops: `branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning`, `fetchBranches()`, `onCreateWorktree()`, `onRemoveWorktree()`, and the duplicate `worktreeStatus` watcher

**`TaskInfoTab.vue`** (after cleanup):
- Drops: `branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning`, `worktreeBasePath` props; `createWorktree`, `removeWorktree` emits; entire worktree section template; `WorktreeCreateForm` import

## Risks / Trade-offs

[Users may not find worktree controls immediately] → Mitigation: Git tab uses `pi pi-code-branch` icon which is recognisable; tab label "Git" is explicit. The info tab label remains to signal what moved where.

[Muscle memory disruption for users accustomed to Info tab] → Acceptable: the move is predictable. Worktree is git, Git tab is the right home.

[Duplicate watcher removal] → The two watchers in `TaskInfoPanel.vue` (lines 101–111 and 114–123) are functionally identical. Removing one is a pure cleanup with no behavior change.
