## ADDED Requirements

### Requirement: Per-tool result size limits

The system SHALL support per-tool `maxResultSizeChars` values that override the global `TOOL_RESULT_MAX_CHARS` when truncating tool results before storing in conversation history. Each tool MAY declare its own limit. Tools without a declared limit SHALL use the global default (8,000 chars).

#### Scenario: Tool with custom limit uses that limit
- **WHEN** `search_text` returns 25,000 chars and its `maxResultSizeChars` is 20,000
- **THEN** the stored result is truncated to 20,000 chars with a `[truncated]` suffix

#### Scenario: Tool without custom limit uses global default
- **WHEN** a tool without a declared limit returns 10,000 chars
- **THEN** the stored result is truncated to the global default of 8,000 chars

### Requirement: Tool result size limit values

The system SHALL use the following per-tool result size limits:

| Tool | maxResultSizeChars |
|------|-------------------|
| `read_file` | 50,000 |
| `search_text` | 20,000 |
| `find_files` | 10,000 |
| `run_command` | 30,000 |
| `spawn_agent` | 100,000 |
| `edit_file` | 2,000 |
| `write_file` | 2,000 |
| All others | 8,000 (global default) |

#### Scenario: spawn_agent result not over-truncated
- **WHEN** `spawn_agent` returns a 50,000 char result
- **THEN** the full result is stored (within the 100,000 limit) instead of being truncated at 8,000
