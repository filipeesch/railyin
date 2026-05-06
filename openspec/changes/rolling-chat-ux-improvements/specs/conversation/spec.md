## ADDED Requirements

### Requirement: Claude tool result content arrays are normalized to strings
The system SHALL normalize Claude API tool result `content` from array format (`Array<{type:'text', text:string}>`) to a plain string in `claude/events.ts` before emitting the `tool_result` event. The normalized value SHALL be stored in the `formattedContent` field.

#### Scenario: Array content is joined to a string
- **WHEN** Claude returns a tool result with `content` as `[{type:'text', text:'hello'}, {type:'text', text:'world'}]`
- **THEN** the emitted `tool_result` event has `formattedContent: 'hello\nworld'`

#### Scenario: String content is passed through unchanged
- **WHEN** Claude returns a tool result with `content` as a plain string
- **THEN** the emitted `tool_result` event has `formattedContent` equal to that string

### Requirement: Common tool results include human-readable detailedContent
The system SHALL return a `detailedContent` string from `executeCommonToolText` for all common tools (`create_todo`, `list_tasks`, `update_todo_status`, etc.), wrapped alongside the structured `data` payload. The `detailedContent` value SHALL be a concise human-readable summary suitable for display in the tool result block.

#### Scenario: create_todo result shows readable summary
- **WHEN** `create_todo` succeeds
- **THEN** the tool result `detailedContent` contains a human-readable summary (e.g., "Created todo #3: Fix login bug") rather than raw JSON

#### Scenario: list_tasks result shows readable summary
- **WHEN** `list_tasks` returns results
- **THEN** the tool result `detailedContent` contains a formatted list rather than raw JSON array

### Requirement: Copilot edit tool result shows correct line numbers
The system SHALL extract `startLine` from Copilot edit tool arguments in `buildCopilotNativeDisplay` and include it in `ToolCallDisplay`. When `ReadView` renders the tool result, it SHALL use the correct `startLine` offset.

#### Scenario: Edit tool startLine matches actual edit location
- **WHEN** a Copilot edit tool call targets lines 45-60 of a file
- **THEN** `ToolCallDisplay.startLine` is 45 and `ReadView` renders starting at line 45

### Requirement: ReasoningBubble uses Reasoning/Reasoned labels
The system SHALL display "Reasoning…" (not "Thinking…") in the `ReasoningBubble` component when streaming is active, and "Reasoned" when complete. Both labels SHALL use the same verb root.

#### Scenario: Active streaming shows Reasoning label
- **WHEN** `ReasoningBubble` has `streaming: true`
- **THEN** the label displays "Reasoning…"

#### Scenario: Completed bubble shows Reasoned label
- **WHEN** `ReasoningBubble` has `streaming: false`
- **THEN** the label displays "Reasoned"

### Requirement: ReasoningBubble is fully manually controlled
The system SHALL NOT auto-expand or auto-collapse the `ReasoningBubble`. It SHALL start collapsed. User clicks are the only mechanism to open or close it.

#### Scenario: Bubble starts collapsed
- **WHEN** a `ReasoningBubble` is first rendered (streaming or not)
- **THEN** it is in collapsed state

#### Scenario: User opens bubble
- **WHEN** the user clicks the bubble header
- **THEN** it expands to show content

#### Scenario: User closes bubble
- **WHEN** the bubble is open and the user clicks the header
- **THEN** it collapses
