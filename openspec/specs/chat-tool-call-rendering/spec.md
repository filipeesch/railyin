## ADDED Requirements

### Requirement: ToolCallBlock is a shared rendering component for both stream paths
The system SHALL provide a `ToolCallBlock.vue` component that accepts a normalized `ToolCallProps` interface and renders a collapsible tool call row. It SHALL be used by both `StreamBlockNode.vue` (live stream path) and `ToolCallGroup.vue` (persisted path). Each caller SHALL adapt its own data shape to `ToolCallProps` before passing to `ToolCallBlock`.

#### Scenario: Persisted path renders via ToolCallBlock
- **WHEN** `ToolCallGroup` renders a completed `ToolEntry` from the database
- **THEN** it adapts the entry to `ToolCallProps` and renders via `ToolCallBlock`

#### Scenario: Live stream path renders via ToolCallBlock
- **WHEN** `StreamBlockNode` renders a `tool_call` StreamBlock during active streaming
- **THEN** it adapts the block to `ToolCallProps` and renders via `ToolCallBlock`

### Requirement: ToolCallProps normalizes the data contract
The system SHALL define a `ToolCallProps` interface with fields: `callId`, `label`, `subject`, `contentType`, `startLine`, `status` (`'pending' | 'done' | 'error'`), `result` (`{ content: string; isError: boolean } | null`), `diffPayloads` (`FileDiffPayload[]`), and `children` (`ToolCallProps[]`).

#### Scenario: ToolCallBlock renders file content for file tools
- **WHEN** `contentType === 'file'` and `result` is set with no diff children
- **THEN** `ReadView` is rendered with `result.content` and `startLine`

#### Scenario: ToolCallBlock renders terminal output for shell tools
- **WHEN** `contentType === 'terminal'` and `result` is set
- **THEN** result content is shown in a pre/output block

#### Scenario: ToolCallBlock renders file diffs when present
- **WHEN** `diffPayloads.length > 0`
- **THEN** `FileDiff` components are rendered for each payload

### Requirement: Subagent tool calls are rendered nested inside their spawning tool
The system SHALL render subagent tool calls as children inside the body of the spawning `task`/`spawn_agent` tool call, collapsed by default. The spawning tool SHALL display a badge showing the child count.

#### Scenario: Subagent children are collapsed by default
- **WHEN** the spawning tool is expanded
- **THEN** its child tool calls are shown in collapsed state, requiring individual clicks to expand

#### Scenario: Badge shows child count
- **WHEN** a tool call has one or more children
- **THEN** a sitemap icon and count badge are visible on the tool header row

### Requirement: Spawning tool pulses while subagent is running
The system SHALL apply a pulsing animation to the spawning tool's sitemap icon while `status === 'pending'` and `children.length > 0`. The animation SHALL stop and the icon SHALL become static when `status` transitions to `'done'` or `'error'`.

#### Scenario: Pulse during active subagent execution
- **WHEN** `status === 'pending'` and the spawning tool has child blocks
- **THEN** the sitemap badge icon pulses with the same keyframe as `ReasoningBubble`

#### Scenario: Pulse stops on completion
- **WHEN** `status` transitions to `'done'`
- **THEN** the sitemap icon is static and shows no animation

### Requirement: StreamBlockNode becomes a pure router component
The system SHALL refactor `StreamBlockNode.vue` to a router component that reads the block type and delegates rendering to the appropriate sub-component (`ToolCallBlock`, `ReasoningBubble`, etc.). It SHALL NOT contain inline template logic for tool call rendering.

#### Scenario: StreamBlockNode delegates tool_call to ToolCallBlock
- **WHEN** `StreamBlockNode` receives a block with `type === 'tool_call'`
- **THEN** it adapts the block to `ToolCallProps` and renders `<ToolCallBlock>`

### Requirement: useToolResultDisplay composable consolidates result extraction
The system SHALL provide a `useToolResultDisplay` composable that extracts displayable text from a tool result content string, prioritizing: `detailedContent` → `contents[].text` → `content` → raw string. It SHALL be used by both `ToolCallBlock` and the adapter in `ToolCallGroup`.

#### Scenario: detailedContent takes priority
- **WHEN** a tool result JSON contains both `detailedContent` and `content`
- **THEN** `useToolResultDisplay` returns `detailedContent`

#### Scenario: Array contents are joined
- **WHEN** tool result JSON contains `contents: [{type:'text', text:'...'}]`
- **THEN** text parts are joined into a single string
