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
The system SHALL render subagent tool calls as children inside the body of the spawning `delegate`/`task`/`spawn_agent` tool call when the spawning parent is present in the loaded conversation slice. When the spawning parent is **not** in the loaded slice (because it lives on an older, not-yet-paged page), the subagent child SHALL be rendered as a standalone top-level tool entry so it remains visible. The spawning tool — when present — SHALL display a badge showing the count of children currently loaded.

#### Scenario: Subagent children are collapsed by default
- **WHEN** the spawning tool is present in the loaded slice and is expanded
- **THEN** its child tool calls are shown in collapsed state, requiring individual clicks to expand

#### Scenario: Badge shows child count
- **WHEN** a spawning tool is present and has one or more children in the loaded slice
- **THEN** a sitemap icon and count badge are visible on the tool header row reflecting the loaded child count

#### Scenario: Orphaned subagent child renders standalone when parent is in an older page
- **WHEN** the loaded conversation slice contains a `tool_call` with `metadata.parent_tool_call_id` set
- **AND** no entry with that `parent_tool_call_id` exists in the loaded slice
- **THEN** the child is rendered as a top-level tool entry in the conversation timeline (not silently dropped)

#### Scenario: Orphaned children re-nest after their parent is paged in
- **WHEN** the user scrolls up and `loadOlderMessages()` brings the spawning parent into the loaded slice
- **THEN** previously-orphaned children re-nest under the parent on the next reactive recompute, and the parent's child-count badge updates accordingly

#### Scenario: Filtering of subagent children is owned by `pairToolMessages`
- **WHEN** `ConversationBody` builds its `displayItems` list from the loaded messages
- **THEN** it SHALL trust the `topLevel` array returned by `pairToolMessages` and SHALL NOT apply any additional `parent_tool_call_id`-based filtering

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

### Requirement: `buildDisplayItems` is a pure, importable utility
The system SHALL expose a `buildDisplayItems(messages: ConversationMessage[], hasStreamTail: boolean): DisplayItem[]` function in `src/mainview/utils/buildDisplayItems.ts`. `ConversationBody.vue` SHALL delegate its `displayItems` computed to this function. The utility SHALL have no Vue, Pinia, or DOM dependency.

#### Scenario: Orphaned subagent children produce tool_entry display items
- **GIVEN** a `messages` input whose only entries are `tool_call` rows with `metadata.parent_tool_call_id` set to an ID absent from the input
- **WHEN** `buildDisplayItems` is called with `hasStreamTail: false`
- **THEN** it returns one `{ kind: "tool_entry" }` item per orphaned child — none are dropped

#### Scenario: Regular assistant/user messages produce single display items
- **GIVEN** a `messages` input of non-tool messages
- **WHEN** `buildDisplayItems` is called
- **THEN** each message maps to a `{ kind: "single" }` item

#### Scenario: `hasStreamTail: true` appends a stream_tail item
- **GIVEN** any `messages` input
- **WHEN** `buildDisplayItems` is called with `hasStreamTail: true`
- **THEN** the last item in the result has `kind: "stream_tail"`

#### Scenario: Mixed tool + non-tool messages are correctly split into groups
- **GIVEN** a messages input: [assistant, tool_call, tool_result, assistant]
- **WHEN** `buildDisplayItems` is called
- **THEN** result is [single, tool_entry, single] — tool pair grouped, non-tool items individual
