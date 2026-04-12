## Purpose
The task detail drawer is the primary surface for interacting with a task. Beyond conversation, it surfaces git context, execution metadata, and management actions.

## Requirements

### Requirement: Task detail drawer opens at 70% of viewport width by default and resets on close
The system SHALL initialise the task detail drawer width to 70% of the current viewport width when the component is first mounted, and SHALL reset to that value each time the drawer is closed.

#### Scenario: Drawer opens at 70% width
- **WHEN** the task detail drawer is opened for the first time in a session
- **THEN** the drawer width equals 70% of the viewport width at mount time

#### Scenario: Drawer resets to 70% after closing
- **WHEN** the drawer is closed (by clicking outside or the × button)
- **THEN** the next open uses the 70% default width, not any manually resized width from the previous session

#### Scenario: Manual resize preserves user preference within a single open
- **WHEN** the user drags the resize handle to a custom width
- **THEN** the drawer retains that custom width until it is closed

### Requirement: Task detail drawer closes on outside clicks but not on overlay interactions
The system SHALL close the task detail drawer when the user clicks outside it, UNLESS a PrimeVue overlay (dropdown panel, dialog backdrop) or an internal dialog (edit task, delete task) is currently active.

#### Scenario: Click on board closes drawer
- **WHEN** the task detail drawer is open and the user clicks on the board area (outside the drawer)
- **THEN** the drawer closes

#### Scenario: Click on Select dropdown does not close drawer
- **WHEN** the task detail drawer is open, a Select dropdown panel is open, and the user clicks an option in that panel
- **THEN** the drawer remains open and the selected value is applied

#### Scenario: Click in Delete dialog does not close drawer
- **WHEN** the delete task confirmation dialog is open
- **THEN** clicking within the dialog does not close the task detail drawer

#### Scenario: Click in Edit dialog does not close drawer
- **WHEN** the edit task dialog is open
- **THEN** clicking within the dialog does not close the task detail drawer

### Requirement: Chat input row contains a context-aware send/cancel action
The system SHALL render a single action button in the chat input row whose icon and behaviour adapt to the task's execution state.

#### Scenario: Send button shown when task is idle
- **WHEN** the task's `executionState` is not `running`
- **THEN** the action button shows a send icon and clicking it submits the textarea content

#### Scenario: Send button disabled when textarea is empty
- **WHEN** the task's `executionState` is not `running` and the textarea is empty
- **THEN** the send action button is disabled

#### Scenario: Cancel button shown when task is running
- **WHEN** the task's `executionState` is `running`
- **THEN** the action button shows a stop icon and clicking it cancels the running execution

#### Scenario: Cancel button is always enabled when task is running
- **WHEN** the task's `executionState` is `running`
- **THEN** the cancel action button is enabled regardless of textarea content

### Requirement: Model selector is placed below the chat textarea
The system SHALL display the model selector below the message textarea, within the input area, rather than in the side panel.

#### Scenario: Model selector visible below textarea
- **WHEN** the task detail drawer is open and models are available
- **THEN** the model selector is rendered below the textarea in the input area

#### Scenario: Model selector absent from side panel
- **WHEN** the task detail drawer is open
- **THEN** no model selector appears in the side panel metadata section

#### Scenario: Selecting a model does not close the drawer
- **WHEN** the user opens the model selector and selects a different model
- **THEN** the selected model is applied to the task and the drawer remains open

### Requirement: Task drawer displays git context and execution summary
The system SHALL display the task's worktree status, branch name, worktree path, git diff stat, and total execution attempt count in the side panel of the task detail drawer. The side panel SHALL NOT contain model selector or cancel execution controls.

#### Scenario: Branch name shown in side panel
- **WHEN** a task detail drawer is open and the task has a branch name in `task_git_context`
- **THEN** the branch name is displayed in the side panel

#### Scenario: Worktree path shown in side panel
- **WHEN** a task's `worktree_status` is `ready`
- **THEN** the worktree path is displayed in the side panel

#### Scenario: Worktree status shown in side panel
- **WHEN** a task detail drawer is open
- **THEN** the worktree status (`not_created`, `creating`, or `ready`) is shown in a human-readable form

#### Scenario: Git diff stat shown when worktree ready
- **WHEN** a task's worktree is in `ready` status and the drawer opens
- **THEN** `git diff --stat HEAD` is fetched via `tasks.getGitStat` and the result is displayed in the side panel

#### Scenario: Git diff stat not shown when worktree not ready
- **WHEN** a task's `worktree_status` is `not_created` or `creating`
- **THEN** no git diff stat section is displayed

#### Scenario: Execution count shown in side panel
- **WHEN** a task detail drawer is open
- **THEN** the total number of executions for the task is displayed in the side panel

### Requirement: Task detail drawer header shows changed-files badge and sync button
The system SHALL display a changed-files badge in the task detail drawer header when `tasks.getChangedFiles` returns a non-empty array for the task. The badge SHALL show the file count and, when clicked, SHALL open the code review overlay. The system SHALL also display a sync (refresh) button in the drawer header at all times when a task is open; clicking it calls `tasks.getChangedFiles` and updates the badge count without opening the overlay.

#### Scenario: Badge shown in drawer header when files are changed
- **WHEN** the task detail drawer is open and the task's worktree has uncommitted changes
- **THEN** a badge showing the changed file count is visible in the drawer header

#### Scenario: Clicking badge in drawer header opens review overlay
- **WHEN** the user clicks the changed-files badge in the task detail drawer header
- **THEN** the code review overlay opens for that task

#### Scenario: Badge absent from drawer when worktree is clean
- **WHEN** the task detail drawer is open and the worktree has no uncommitted changes
- **THEN** no changed-files badge appears in the drawer header

#### Scenario: Sync button refreshes changed-files count
- **WHEN** the user clicks the sync button in the drawer header
- **THEN** `tasks.getChangedFiles` is called and the badge count updates to reflect the current state of the worktree

#### Scenario: Changed-files count refreshed on drawer open
- **WHEN** the task detail drawer opens for a task with `worktreeStatus: 'ready'`
- **THEN** `tasks.getChangedFiles` is called automatically and the badge reflects the current count

### Requirement: Tool calls are displayed as individual collapsible rows in the conversation
The system SHALL render each tool call triplet (`tool_call` + `tool_result` + optional `file_diff`) as a single self-contained collapsible row in the conversation thread. Each row SHALL be independent — there is no outer grouping wrapper around consecutive tool calls.

The collapsed header SHALL show, left to right:
- A chevron indicating collapsed/expanded state
- A tool-type icon
- The tool name in monospace
- The primary argument (path, pattern, URL, or command) truncated if necessary
- Green `+N` badge when `diff.added > 0`
- Red `-N` badge when `diff.removed > 0`

The expanded body SHALL show:
- For write tools (tools that produced a `file_diff` message): the `FileDiff` component rendering the diff payload
- For read/search tools (no `file_diff`): the raw tool output in a scrollable `<pre>` block

`file_diff` messages SHALL NOT be rendered as standalone conversation items — they are consumed exclusively by the tool call row.

#### Scenario: Read tool row shows output on expand
- **WHEN** the user expands a tool call row for `read_file` or `list_dir`
- **THEN** the body shows the tool output text, not a file diff

#### Scenario: Write tool row shows diff on expand
- **WHEN** the user expands a tool call row for `write_file` or `patch_file`
- **THEN** the body shows the FileDiff component with added/removed hunks

#### Scenario: Stat badges shown for write tools with changes
- **WHEN** a write tool produced `diff.added > 0` or `diff.removed > 0`
- **THEN** the corresponding green `+N` or red `-N` badge is visible in the collapsed header

#### Scenario: No stat badges for tools with zero lines changed
- **WHEN** a write tool produced `diff.added === 0` and `diff.removed === 0`
- **THEN** no stat badge is rendered in the header

#### Scenario: Each tool call is its own independent row
- **WHEN** three consecutive tool calls appear in the conversation
- **THEN** three separate collapsible rows are rendered, each independently expandable

#### Scenario: Empty tool result shows placeholder text
- **WHEN** a tool call completes successfully but exposes neither diff content nor readable output text
- **THEN** the expanded tool row shows a placeholder such as "No output produced"

### Requirement: Task detail drawer renders `reasoning` messages as collapsible ReasoningBubble components
The system SHALL dispatch on `type: "reasoning"` in the conversation timeline and render a `ReasoningBubble` component. Messages loaded from DB SHALL render collapsed. Messages actively streaming SHALL render expanded with animation (handled via the transient store state keyed by round ID).

When reasoning blocks have child tool_call blocks (via `parentBlockId`), the `StreamBlockNode` SHALL render those tool calls inside the reasoning bubble's expanded body, visually grouping the tools with the reasoning that triggered them.

#### Scenario: Reasoning message from DB renders collapsed
- **WHEN** the drawer opens and the conversation history contains a `reasoning` message
- **THEN** a collapsed `ReasoningBubble` is rendered at the correct position in the timeline showing the reasoning text when expanded

#### Scenario: Active reasoning renders expanded with animation
- **WHEN** the task store has an active reasoning round (streaming in progress)
- **THEN** the `ReasoningBubble` for that round is rendered expanded with a pulsing "Thinking…" header

#### Scenario: Reasoning bubble positioned before its associated response
- **WHEN** a `reasoning` message is followed by a `tool_call` or `assistant` message in the timeline
- **THEN** the `ReasoningBubble` appears immediately above the associated message in the rendered list

#### Scenario: Tool calls appear inside reasoning bubble when grouped
- **WHEN** a reasoning block in the stream state has child tool_call blocks
- **THEN** the `StreamBlockNode` renders those tool_call blocks inside the reasoning bubble's body section, visually nested under the reasoning content

### Requirement: Task detail drawer auto-scroll is anchored to the live conversation timeline
The task detail drawer SHALL auto-scroll while the user remains near the bottom of the conversation. Anchored scrolling SHALL react to all live timeline growth, including streaming reasoning, streaming assistant output, and other live execution state rendered in the conversation.

#### Scenario: Streaming reasoning keeps the drawer anchored
- **WHEN** reasoning tokens extend the active reasoning bubble and the user is still at the bottom threshold
- **THEN** the drawer remains scrolled to the newest visible content

#### Scenario: User scrolling away pauses auto-scroll
- **WHEN** the user scrolls above the bottom threshold during an active execution
- **THEN** new live conversation content does not force the drawer back to the bottom

#### Scenario: Returning to the bottom resumes auto-scroll
- **WHEN** the user scrolls back within the bottom threshold while an execution is still producing live content
- **THEN** anchored auto-scroll resumes for subsequent timeline growth

### Requirement: Standard chat bubbles use compact typography
Standard user and assistant chat bubbles SHALL use slightly smaller body text than the surrounding drawer defaults, improving message density without reducing readability of specialized technical views.

#### Scenario: Message bubbles use compact body size
- **WHEN** a normal `user` or `assistant` message is rendered in the task drawer
- **THEN** its bubble text uses the compact chat body size

### Requirement: Task detail drawer shows Session Notes
The system SHALL display a "Session Notes" section in the task detail drawer showing the current contents of the task's session memory notes file. The section SHALL be collapsed by default and expandable by the user.

#### Scenario: Session Notes section visible when notes exist
- **WHEN** the task detail drawer opens and the task has a session memory notes file
- **THEN** a collapsed "Session Notes" section is visible in the drawer

#### Scenario: Session Notes section hidden when no notes
- **WHEN** the task detail drawer opens and the task has no session memory notes file
- **THEN** no Session Notes section is rendered

#### Scenario: User can expand to read notes
- **WHEN** the user clicks the "Session Notes" section header
- **THEN** the full notes content is displayed as rendered markdown

#### Scenario: Notes content is read-only
- **WHEN** the Session Notes section is expanded
- **THEN** there is no edit control — the content is read-only display

### Requirement: ReadView displays line numbers with correct offset from tool call arguments
The `ReadView` component SHALL accept an optional `startLine` prop (1-based). When provided, line numbers in the gutter SHALL begin at `startLine` instead of 1. When the prop is omitted or 0, line numbers SHALL start at 1 (preserving backward compatibility).

#### Scenario: ReadView with startLine offset shows correct line numbers
- **WHEN** the `ReadView` component receives `startLine=50` and displays 20 lines of content
- **THEN** the gutter shows line numbers 50 through 69

#### Scenario: ReadView without startLine shows lines from 1
- **WHEN** the `ReadView` component receives no `startLine` prop
- **THEN** the gutter shows line numbers starting from 1

#### Scenario: ToolCallGroup passes startLine from read_file arguments to ReadView
- **WHEN** a `read_file` tool call has `startLine: 50` in its parsed arguments
- **THEN** `ToolCallGroup` passes `:startLine="50"` to the `ReadView` component

### Requirement: Toast notifications are suppressed for the currently active task
The system SHALL NOT display toast notifications for task state changes when the task is the currently active (visible) task in the detail drawer. Toast notifications SHALL still fire for non-active tasks to alert the user of background activity.

#### Scenario: No toast for active task state change
- **WHEN** the currently active task transitions from `running` to `completed`
- **THEN** no toast notification is displayed

#### Scenario: Toast fires for background task state change
- **WHEN** a task that is NOT the currently active task transitions from `running` to `completed`
- **THEN** a toast notification is displayed with the task summary

#### Scenario: Toast fires for active task errors
- **WHEN** the currently active task encounters a stream error (via `onStreamError`)
- **THEN** the error toast IS still displayed (error toasts are not suppressed)
