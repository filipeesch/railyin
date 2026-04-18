## 1. Remove Side Panel

- [x] 1.1 Remove the `task-detail__side` div and all its contents from `TaskDetailDrawer.vue`
- [x] 1.2 Remove the two-column CSS layout (`task-detail__body` flex row) — make the conversation full width
- [x] 1.3 Remove the `task-detail__side` CSS classes
- [x] 1.4 Remove session notes data fetching and `sessionMemoryContent` computed (no longer surfaced)

## 2. Toolbar Row

- [x] 2.1 Add a `drawer-toolbar` row between the header and the tab content in `TaskDetailDrawer.vue`
- [x] 2.2 Add the Chat / Info tab switcher anchored to the left of the toolbar (use PrimeVue `TabList` or custom toggle buttons)
- [x] 2.3 Add the workflow state `Select` dropdown to the toolbar right cluster, populated with all board columns, current column as selected value
- [x] 2.4 Wire the workflow select `@change` handler to call the transition RPC (reuse existing `transition()` logic from side panel)
- [x] 2.5 Add the Terminal button to the toolbar right cluster; show only when `task.worktreePath` is set
- [x] 2.6 Wire the Terminal button to call the open-terminal RPC with `task.worktreePath`
- [x] 2.7 Move the existing `LaunchButtons` (Run / Tools) into the toolbar right cluster, replacing the standalone `launch-bar` div
- [x] 2.8 Remove the standalone `launch-bar` div and its CSS

## 3. Header Cleanup

- [x] 3.1 Remove the `[✏ Edit]` pencil button from the drawer header
- [x] 3.2 Keep the execution state tag (`●running`) in the header — no change needed
- [x] 3.3 Keep the `[⟳ Sync]` and `[🗑 Delete]` buttons in the header

## 4. Chat Tab Content

- [x] 4.1 Wrap the conversation timeline, changed files panel, todo panel, and chat input in a `v-if="activeTab === 'chat'"` container
- [x] 4.2 Verify the conversation timeline stretches to full drawer width with the side panel gone

## 5. Info Tab Component

- [x] 5.1 Create `TaskInfoTab.vue` component accepting `task` and `board` props
- [x] 5.2 Add Project section: display board name and project key
- [x] 5.3 Add Worktree section: display branch name, worktree path, worktree status — hide section entirely if none are set
- [x] 5.4 Add Description section: render `task.description` as markdown using the existing `renderMd` utility
- [x] 5.5 Add inline `[✏ Edit]` button next to the Description heading that calls `openTaskOverlay()`
- [x] 5.6 Show the Description section even when `task.description` is empty (edit button still accessible)
- [x] 5.7 Wrap the Info tab in a `v-if="activeTab === 'info'"` container in `TaskDetailDrawer.vue`

## 6. Tab State

- [x] 6.1 Add `activeTab` ref (default `'chat'`) to `TaskDetailDrawer.vue`
- [x] 6.2 Reset `activeTab` to `'chat'` when the drawer closes (`onHide`)

## 7. CSS & Polish

- [x] 7.1 Style the toolbar row: flex row, space-between, `gap`, appropriate padding
- [x] 7.2 Style the workflow select to be compact (small size, truncate long column names)
- [x] 7.3 Style the Info tab content: section headings, metadata rows, markdown description area
- [ ] 7.4 Verify the drawer resize handle still works correctly with the new layout
- [ ] 7.5 Test in dark mode
