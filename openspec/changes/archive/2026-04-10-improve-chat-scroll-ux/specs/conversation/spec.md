## MODIFIED Requirements

### Requirement: Conversation is an append-only message timeline
Each task's conversation SHALL be an ordered, append-only sequence of messages. The canonical chronology SHALL follow append order, and conversation reads SHALL preserve that order even when multiple messages share the same timestamp.

#### Scenario: Messages created in the same second keep append order
- **WHEN** `reasoning`, `tool_call`, `tool_result`, `file_diff`, and `assistant` messages are appended within the same timestamp second
- **THEN** conversation reads return them in the same order they were appended

#### Scenario: Timeline assembly does not reorder neighboring message types
- **WHEN** the frontend groups tool rows or renders live chat items
- **THEN** the visible conversation preserves the same relative order as the underlying append-only message sequence
