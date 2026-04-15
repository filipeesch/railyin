## MODIFIED Requirements

### Requirement: ToolCallGroup.vue shows +N/-N stat badges for write operations
The system SHALL render green `+N` and red `-N` count badges in the `ToolCallGroup` header for any tool entry that has associated file-change data. Tool rows SHALL consume structured `tool_result.writtenFiles` as the canonical source and MAY fall back to legacy `file_diff` payloads for backward compatibility during migration.

#### Scenario: Header shows added/removed counts
- **WHEN** a tool entry has file-change data with `added > 0` or `removed > 0`
- **THEN** the header row shows a green `+N` badge and/or a red `-N` badge

#### Scenario: No badge when counts are zero
- **WHEN** a tool entry has file-change data with `added: 0` and `removed: 0` (e.g. rename)
- **THEN** no stat badges appear in the header

#### Scenario: Copilot file edit shows line-level changes
- **WHEN** a Copilot tool result describes a file edit and includes sufficient diff detail for the UI
- **THEN** the tool row renders added and removed lines instead of an empty output shell

#### Scenario: Fallback placeholder shown when no visible diff or output exists
- **WHEN** a write-oriented tool result contains no renderable diff detail and no readable output text
- **THEN** the expanded row renders the explicit no-output placeholder rather than an empty collapsible body

#### Scenario: Structured tool result takes precedence over legacy file_diff
- **WHEN** both structured `writtenFiles` and legacy `file_diff` are present for the same tool call
- **THEN** the UI renders the structured `writtenFiles` representation as the primary source
