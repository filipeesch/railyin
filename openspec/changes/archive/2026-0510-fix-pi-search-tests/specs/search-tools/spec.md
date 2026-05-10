## MODIFIED Requirements

### Requirement: search_tool now uses SDK built-in grep/find/ls instead of custom search_text
The system SHALL expose search capability via Pi SDK's built-in `grep`, `find`, and `ls` tools. These tools are enabled globally through `createAgentSession`'s `tools: ["grep", "find", "ls"]` parameter. The custom `search_text` tool is REMOVED — it was broken due to missing `rg` dependency and contained dead code (`invalidateSearchByPath`).

**Reason**: Custom `search_text` depended on externally-installed `rg` (ripgrep). When `rg` was not installed, `spawnSync` returned `status === null` which fell through to the "no matches" path indistinguishable from actual zero results. Pi SDK's `grep` auto-downloads `rg` via `ensureTool("rg", true)` if missing, providing a reliable replacement.

**Migration**: Agents previously using `search_text` schema with `pattern`/`glob`/`context_lines`/`output_mode`/`offset` parameters must adapt to Pi SDK's native `grep`, `find`, `ls` tools. System prompts for Pi engine should reference SDK tool names.

#### Scenario: SDK grep tool events flow through pipeline
- **WHEN** Pi SDK emits `tool_execution_start` for a `grep` tool call
- **THEN** a `tool_start` EngineEvent is emitted with tool_name `"grep"`
- **AND WHEN** Pi SDK emits `tool_execution_end` for the same tool call
- **THEN** a `tool_result` EngineEvent is emitted with the search results

#### Scenario: No search_text tool in tool registry
- **WHEN** `buildAllTools()` is called
- **THEN** the returned tool list SHALL NOT contain any tool named `search_text`

#### Scenario: search_text removed from workflow YAML
- **WHEN** workflow YAML is loaded
- **THEN** column tool configurations SHALL NOT reference `search` group
- **AND WHEN** a column prompts tool use for search
- **THEN** SDK `grep`/`find`/`ls` are used instead (always available)

## ADDED Requirements

### Requirement: Test coverage for PI_TOOL_GROUPS exclusion
The test suite SHALL validate that `PI_TOOL_GROUPS` has exactly 4 entries (`read`, `write`, `shell`, `web`) and no `search` group exists.

#### Scenario: PI_TOOL_GROUPS has correct groups
- **WHEN** `PI_TOOL_GROUPS` keys are inspected
- **THEN** they SHALL equal `["read", "write", "shell", "web"]`

#### Scenario: PI_TOOL_GROUPS has no search group
- **WHEN** `PI_TOOL_GROUPS` is checked for a `search` key
- **THEN** the key SHALL NOT exist
