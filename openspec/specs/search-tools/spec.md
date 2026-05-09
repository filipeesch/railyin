# Spec Delta: search_text removal + SDK search tool replacement

## MODIFIED Requirements

### Requirement: Pi tool groups exclude search_text
The Pi engine tool registry SHALL NOT include a `search_text` tool or `search` tool group. Search functionality is provided exclusively through Pi SDK's built-in `grep`, `find`, and `ls` tools.

#### Scenario: PI_TOOL_GROUPS has no search key
- **WHEN** `PI_TOOL_GROUPS` is inspected
- **THEN** it has exactly 4 keys: `read`, `write`, `shell`, `web`
- **AND** it does NOT have a `search` key

#### Scenario: DEFAULT_PI_TOOL_GROUPS has no search
- **WHEN** `DEFAULT_PI_TOOL_GROUPS` is inspected
- **THEN** it has exactly 3 entries: `read`, `write`, `shell`
- **AND** it does NOT contain `search`

#### Scenario: buildAllTools() excludes search_text
- **WHEN** `buildAllTools({ harnessCtx, commonCtx })` is called
- **THEN** the returned tool array does NOT contain any tool named `search_text`

#### Scenario: Column filtering respects columnGroups
- **WHEN** `buildAllTools({ harnessCtx, commonCtx, columnGroups: ["read"] })` is called
- **THEN** only tools from the `read` group are returned (plus common tools)
- **AND** no `search` tools are present

## ADDED Requirements

### Requirement: SDK search tools enabled via createAgentSession
Pi SDK's built-in `grep`, `find`, and `ls` tools SHALL be enabled via the `tools` parameter passed to `createAgentSession`.

#### Scenario: SDK tools are enabled
- **WHEN** `createAgentSession()` is called
- **THEN** `tools: ["grep", "find", "ls"]` is included in the options

### Requirement: Dependency cleanup
After removing `search_text`, `picomatch` and `rimraf` SHALL no longer be imported anywhere in the codebase.

#### Scenario: picomatch not imported
- **WHEN** the codebase is searched for `picomatch` imports
- **THEN** no matches are found

#### Scenario: rimraf not imported
- **WHEN** the codebase is searched for `rimraf` imports in TS files
- **THEN** no matches are found
