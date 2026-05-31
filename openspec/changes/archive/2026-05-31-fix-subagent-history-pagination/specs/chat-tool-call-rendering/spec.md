## MODIFIED Requirements

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
