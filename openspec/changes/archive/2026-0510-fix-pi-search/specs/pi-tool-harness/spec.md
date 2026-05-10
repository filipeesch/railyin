## Purpose
This delta spec modifies the `pi-tool-harness` capability to remove the `search_text` tool and `search` tool group, which are replaced by Pi SDK's built-in `grep`/`find`/`ls` tools.

## Changes

### MODIFIED Requirement: Pi tool groups are configurable per workflow column
The `PI_TOOL_GROUPS` map in `src/bun/engine/pi/tools/index.ts` SHALL include tool groups: `read`, `write`, `shell`, `web`. The `search` group SHALL be removed since search is provided by Pi SDK built-in tools.

#### Scenario: Column configured with read+shell groups gets only those tools
- **WHEN** a column has `tools: ["read", "shell"]` and the Pi engine builds tools for an execution
- **THEN** `buildAllTools` returns only `read_file`, `glob`, `run_command` (plus board/interaction common tools)
- **AND** no `search_text` is returned

#### Scenario: Column with no tools config gets full default tool set
- **WHEN** a column has no `tools:` config
- **THEN** `buildAllTools` returns the default tool set: `read`, `write`, `shell`
- **AND** no `search` group is included

### REMOVED Requirements
- `search_text` tool specification — replaced by Pi SDK `grep`
- `search` tool group in `PI_TOOL_GROUPS` map
- `search` entry in `DEFAULT_PI_TOOL_GROUPS`
