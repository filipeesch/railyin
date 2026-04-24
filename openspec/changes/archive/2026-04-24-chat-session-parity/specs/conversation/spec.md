## ADDED Requirements

### Requirement: Standalone sessions render structured streaming conversation state
The system SHALL render standalone session conversations with the same structured streaming tree used in task chat, including reasoning blocks, tool call blocks, tool results, and status updates.

#### Scenario: Session tool call stream renders as grouped blocks
- **WHEN** a standalone session emits structured stream events for tool calls and tool results
- **THEN** the conversation timeline renders grouped tool blocks rather than only raw token text

#### Scenario: Session reasoning stream renders inline
- **WHEN** a standalone session emits reasoning stream events
- **THEN** the conversation timeline renders reasoning content with the same interaction model used in task chat

#### Scenario: Session status chunk renders while execution is active
- **WHEN** a standalone session emits status updates before assistant content is finalized
- **THEN** the shared conversation body shows the streaming status message for that session

