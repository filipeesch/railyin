## ADDED Requirements

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

## MODIFIED Requirements

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
