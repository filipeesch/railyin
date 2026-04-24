## ADDED Requirements

### Requirement: Context usage gauge appears in standalone sessions
The system SHALL display the same context usage gauge and context popover in standalone session chat when the session conversation has a known context window estimate.

#### Scenario: Session context gauge shown when usage is known
- **WHEN** a standalone session chat is open and conversation context usage is available
- **THEN** the session input toolbar shows the same context gauge used in task chat

#### Scenario: Session context gauge hidden when usage unavailable
- **WHEN** a standalone session chat has no context usage estimate
- **THEN** the context gauge is not rendered

### Requirement: Manual compaction is available in standalone sessions
The system SHALL expose manual conversation compaction controls in standalone sessions when the active engine supports manual compaction.

#### Scenario: Session compaction button shown in popover
- **WHEN** the user opens the context popover in a standalone chat session and the engine supports manual compaction
- **THEN** the popover shows the compact action with the same disabled and loading semantics as task chat

#### Scenario: Session context usage refreshes after execution
- **WHEN** a standalone session execution completes
- **THEN** the session context usage is refreshed so the gauge reflects the latest conversation size

