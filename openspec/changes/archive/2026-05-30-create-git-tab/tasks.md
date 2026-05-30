## 1. New Git Tab Components

- [x] 1.1 Create `TaskGitPanel.vue` — smart container with worktree state (`branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning`), `fetchBranches()`, `onCreateWorktree()`, `onRemoveWorktree()`, and a single `worktreeStatus` watcher that triggers `fetchBranches` when status is `not_created`, `removed`, or `error`
- [x] 1.2 Create `TaskGitTab.vue` — presentational component with the worktree template block (status states: ready / creating / error / not_created / removed), accepting all worktree props and emitting `createWorktree` / `removeWorktree`; embed `WorktreeCreateForm` inline

## 2. Simplify TaskInfoPanel and TaskInfoTab

- [x] 2.1 Remove from `TaskInfoPanel.vue`: `branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning` state refs; `fetchBranches()`, `onCreateWorktree()`, `onRemoveWorktree()` methods; both `worktreeStatus` watchers (lines ~101–123, including the duplicate)
- [x] 2.2 Remove from `TaskInfoTab.vue`: `branches`, `createLoading`, `createError`, `removeLoading`, `removeWarning`, `worktreeBasePath` props; `createWorktree` and `removeWorktree` emits; the entire worktree section template block; `WorktreeCreateForm` import

## 3. Wire Git Tab into TaskChatView

- [x] 3.1 Add `"git"` to the `activeTab` ref union type in `TaskChatView.vue`
- [x] 3.2 Add the Git tab button in the toolbar tab switcher (after Info, before Decisions) with icon `pi pi-code-branch` and label "Git"
- [x] 3.3 Add `<TaskGitPanel v-else-if="activeTab === 'git' && task" :task-id="task.id" />` in the tab content area; import `TaskGitPanel`
