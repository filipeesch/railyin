## MODIFIED Requirements

### Requirement: Task detail uses shared ConversationPanel
The task detail view SHALL use the shared `ConversationPanel` component for its conversation timeline and message input. Task-specific chrome (branch name, worktree status, launch config, changed files, execution label) SHALL remain in the `TaskDetailDrawer` wrapper.

#### Scenario: Task conversation renders via ConversationPanel
- **WHEN** the task detail panel opens for a task with a conversation
- **THEN** the conversation timeline renders identically to the previous behavior using the shared component

#### Scenario: Task-specific chrome still visible
- **WHEN** the task detail panel is open
- **THEN** the task branch, worktree status, and launch buttons are visible above or alongside the ConversationPanel

---

### Requirement: Task detail is a docked panel
The task detail view SHALL open as a docked flex panel (see `docked-detail-panel` spec) rather than as a floating overlay Drawer.

#### Scenario: Task detail compresses the board
- **WHEN** the user opens a task's detail panel
- **THEN** the board columns compress horizontally to accommodate the panel (no overlay/dimming)

#### Scenario: Task detail behavior unchanged
- **WHEN** the user interacts with task chat (send message, streaming, stop button, ask_user)
- **THEN** all behavior is functionally identical to the previous overlay implementation
