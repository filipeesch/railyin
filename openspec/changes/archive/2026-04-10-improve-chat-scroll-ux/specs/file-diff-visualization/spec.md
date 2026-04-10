## MODIFIED Requirements

### Requirement: ToolCallGroup.vue shows +N/-N stat badges for write operations
Tool rows SHALL also support richer Copilot-originated edit results by rendering line-level added/removed changes when structured diff data or equivalent detailed tool result content is available.

#### Scenario: Copilot file edit shows line-level changes
- **WHEN** a Copilot tool result describes a file edit and includes sufficient diff detail for the UI
- **THEN** the tool row renders added and removed lines instead of an empty output shell

#### Scenario: Fallback placeholder shown when no visible diff or output exists
- **WHEN** a write-oriented tool result contains no renderable diff detail and no readable output text
- **THEN** the expanded row renders the explicit no-output placeholder rather than an empty collapsible body
