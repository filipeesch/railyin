## Why

The worktree section is buried inside the Info tab alongside project metadata and task description, making it hard to find and contextually misplaced. A dedicated Git tab gives worktree management a clear, expected home and leaves Info as a focused read-only summary.

## What Changes

- A new **Git tab** is added to the task chat drawer (alongside Chat, Info, Decisions)
- The worktree section (branch, path, status, create form, delete) is **moved** from the Info tab to the Git tab
- The Info tab retains only Project metadata and Description
- `TaskInfoTab.vue` loses its worktree props and template block
- `TaskInfoPanel.vue` loses its worktree state, API calls, and watcher logic (including a duplicate watcher that is cleaned up)
- Two new components are added: `TaskGitPanel.vue` (smart container) and `TaskGitTab.vue` (presentational)

## Capabilities

### New Capabilities
- `git-tab`: A dedicated Git tab in the task chat drawer that contains all worktree management controls (create, delete, status display) previously living in the Info tab

### Modified Capabilities
- `task-info-tab`: The worktree and branch metadata sections are removed from the Info tab; Info now shows only Project and Description
- `chat-drawer-tabs`: The tab switcher gains a fourth tab (Git) between Info and Decisions

## Impact

- **New files**: `src/mainview/components/TaskGitPanel.vue`, `src/mainview/components/TaskGitTab.vue`
- **Modified files**: `src/mainview/components/TaskChatView.vue`, `src/mainview/components/TaskInfoPanel.vue`, `src/mainview/components/TaskInfoTab.vue`
- **No backend changes** — all existing API endpoints (`tasks.createWorktree`, `tasks.removeWorktree`, `tasks.listBranches`) are reused unchanged
- **No breaking changes** — worktree behavior and API contract are unchanged; only the UI location changes
- **CSS class contract**: `TaskGitPanel.vue` must place `class="task-tab-git"` on its root element (mirrors `task-tab-info` on `TaskInfoPanel`). This is required by the companion `git-tab-tests` change for scoped Playwright selectors.
