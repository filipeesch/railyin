## Purpose
Reduces effective context window consumption by clearing stale tool result content inline during message assembly, without modifying stored conversation history.

## Requirements

### Requirement: Stale tool results are cleared inline before each API call
The system SHALL apply a recency window to tool result messages when assembling the context for each AI API call. Tool results from turns older than the configured window SHALL have their content replaced with a sentinel string in the assembled payload. The original content in the database SHALL remain unchanged.

#### Scenario: Old tool result is cleared in assembled context
- **WHEN** `compactMessages()` assembles the message history for an API call
- **AND** a tool result message was produced more than `MICRO_COMPACT_TURN_WINDOW` assistant turns ago
- **AND** the tool name is in the clearable tool set
- **THEN** the content in the assembled `AIMessage` is replaced with `[tool result cleared — content no longer in active context]`

#### Scenario: Recent tool results are preserved
- **WHEN** `compactMessages()` assembles the message history for an API call
- **AND** a tool result message was produced within `MICRO_COMPACT_TURN_WINDOW` assistant turns
- **THEN** the full content is preserved in the assembled payload

#### Scenario: Database content is never modified
- **WHEN** micro-compact clearing is applied during assembly
- **THEN** the `conversation_messages` table rows retain their original content unchanged

#### Scenario: Non-clearable tool results are always preserved
- **WHEN** `compactMessages()` assembles the message history
- **AND** a tool result comes from a non-clearable tool (e.g., `ask_me`, `spawn_agent`)
- **THEN** the content is preserved regardless of turn age

### Requirement: Clearable tool set is a named constant
The system SHALL define which tool result types are eligible for micro-compact clearing via a named exported constant `MICRO_COMPACT_CLEARABLE_TOOLS`, listing the tool names: `read_file`, `run_command`, `search_text`, `find_files`, `fetch_url`, `patch_file`.

#### Scenario: Constant is used in assembly
- **WHEN** `compactMessages()` evaluates whether to clear a tool result
- **THEN** it checks membership in `MICRO_COMPACT_CLEARABLE_TOOLS`
