## ADDED Requirements

### Requirement: Task detail drawer renders `reasoning` messages as collapsible ReasoningBubble components
The system SHALL dispatch on `type: "reasoning"` in the conversation timeline and render a `ReasoningBubble` component. Messages loaded from DB SHALL render collapsed. Messages actively streaming SHALL render expanded with animation (handled via the transient store state keyed by round ID).

#### Scenario: Reasoning message from DB renders collapsed
- **WHEN** the drawer opens and the conversation history contains a `reasoning` message
- **THEN** a collapsed `ReasoningBubble` is rendered at the correct position in the timeline showing the reasoning text when expanded

#### Scenario: Active reasoning renders expanded with animation
- **WHEN** the task store has an active reasoning round (streaming in progress)
- **THEN** the `ReasoningBubble` for that round is rendered expanded with a pulsing "Thinking…" header

#### Scenario: Reasoning bubble positioned before its associated response
- **WHEN** a `reasoning` message is followed by a `tool_call` or `assistant` message in the timeline
- **THEN** the `ReasoningBubble` appears immediately above the associated message in the rendered list
