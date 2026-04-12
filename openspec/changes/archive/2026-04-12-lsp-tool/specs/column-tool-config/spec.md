## ADDED Requirements

### Requirement: LSP tool group available in column configuration

The system SHALL support an `lsp` tool group in column `tools` arrays. The `lsp` group SHALL expand to the single `lsp` tool. Columns that do not explicitly include `lsp` in their tools SHALL NOT have access to the LSP tool.

#### Scenario: Column with lsp group has lsp tool
- **WHEN** a column defines `tools: [read, search, lsp]`
- **THEN** the AI request for that column includes the `lsp` tool definition alongside read and search tools

#### Scenario: Default tool set does not include lsp
- **WHEN** a column does not specify any tools (uses defaults)
- **THEN** the `lsp` tool is NOT included in the AI request
