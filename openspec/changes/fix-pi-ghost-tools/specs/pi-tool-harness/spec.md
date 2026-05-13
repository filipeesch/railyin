## MODIFIED Requirements

### Requirement: Pi tool groups are configurable per workflow column
The `PI_TOOL_GROUPS` map in `src/bun/engine/pi/tools/index.ts` SHALL include tool groups: `read`, `write`, `shell`, `web`. The `search` group SHALL be removed since search is provided by Pi SDK built-in tools. Tool descriptions SHALL NOT reference tools that no longer exist in the Pi SDK — specifically `search_text` and `find_files`. The `run_command` tool description SHALL direct the model to use `grep` and `find` (Pi SDK built-in names) for file content search and file pattern matching respectively.

#### Scenario: Column configured with read+shell groups gets only those tools
- **WHEN** a column has `tools: ["read", "shell"]` and the Pi engine builds tools for an execution
- **THEN** `buildAllTools` returns only `read_file`, `glob`, `run_command` (plus board/interaction common tools)
- **AND** no `search_text` is returned

#### Scenario: Column with no tools config gets full default tool set
- **WHEN** a column has no `tools:` config
- **THEN** `buildAllTools` returns the default tool set: `read`, `write`, `shell`
- **AND** no `search` group is included

#### Scenario: run_command description references only current SDK tools
- **WHEN** the `run_command` tool definition is inspected
- **THEN** its description does NOT contain the string `search_text`
- **AND** its description directs the model to prefer `grep` for searching file content and `find` for finding files by pattern

## REMOVED Requirements

### Requirement: search_text display case in Pi tool display
**Reason**: `search_text` no longer exists in the Pi SDK and is unreachable at runtime. The display case was retained as a fallback for old session history but the tool name cannot appear in new tool calls.
**Migration**: Old session history messages that referenced `search_text` fall through to the generic display handler, which renders them adequately.
