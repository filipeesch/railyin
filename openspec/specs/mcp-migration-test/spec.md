# mcp-migration-test Specification

## Purpose
TBD - created by archiving change mcp-disabled-by-default-tests. Update Purpose after archive.
## Requirements
### Requirement: Migration 044 converts NULL enabled_mcp_tools to empty array
The test suite SHALL verify that migration `044_mcp_disabled_by_default` converts all `NULL` values in `tasks.enabled_mcp_tools` and `chat_sessions.enabled_mcp_tools` to the JSON string `'[]'`.

#### Scenario: NULL task rows are converted
- **WHEN** the migration runner applies migration 044 against a DB with tasks containing `enabled_mcp_tools = NULL`
- **THEN** all such rows SHALL have `enabled_mcp_tools = '[]'` after migration

#### Scenario: NULL session rows are converted
- **WHEN** the DB has chat_sessions with `enabled_mcp_tools = NULL`
- **THEN** all such rows SHALL have `enabled_mcp_tools = '[]'` after migration

#### Scenario: Non-null values are untouched
- **WHEN** a task has `enabled_mcp_tools = '["server:tool"]'` and a session has `enabled_mcp_tools = '[]'` before migration
- **THEN** both values SHALL remain unchanged after migration 044 runs

#### Scenario: Migration is idempotent
- **WHEN** migration 044 is run on a DB that already has no NULL values in either column
- **THEN** the migration SHALL complete without error and leave all values unchanged

