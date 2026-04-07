## MODIFIED Requirements

### Requirement: Stale tool results cleared inline when older than MICRO_COMPACT_TURN_WINDOW assistant turns

Stale tool results for clearable tools SHALL be replaced with the sentinel string `"[tool result cleared — content no longer in active context]"` when they are older than `MICRO_COMPACT_TURN_WINDOW` (8) assistant turns. The clearable tool set SHALL be: `read_file`, `run_command`, `search_text`, `find_files`, `fetch_url`, `edit_file`.

#### Scenario: Old edit_file result is cleared
- **WHEN** an `edit_file` tool result is more than 8 assistant turns old
- **THEN** its content is replaced with the sentinel string during message assembly

#### Scenario: Old patch_file results in existing conversations still cleared
- **WHEN** an existing conversation contains a `patch_file` tool result older than 8 turns
- **THEN** its content is replaced with the sentinel string (backward compatibility)
