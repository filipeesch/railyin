## MODIFIED Requirements

### Requirement: Reasoning tokens are surfaced as a collapsible bubble per model round
The system SHALL render each active reasoning bubble as part of the same visible conversation timeline used for persisted messages and live assistant output.

#### Scenario: Streaming reasoning stays in timeline order before its associated response
- **WHEN** a model produces reasoning before a tool call or assistant response
- **THEN** the live reasoning bubble appears in the conversation at that chronological position rather than in a separate visual lane

#### Scenario: Reasoning growth participates in anchored auto-scroll
- **WHEN** the active reasoning bubble grows while the user remains at the bottom threshold
- **THEN** the task drawer auto-scroll keeps the newest reasoning content visible
