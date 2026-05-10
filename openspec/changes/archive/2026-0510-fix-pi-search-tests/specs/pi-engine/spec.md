## MODIFIED Requirements

### Requirement: Tool injection
Pi SDK built-in tools are selectively enabled: `grep`, `find`, and `ls` are exposed alongside our custom harness tools. All other SDK built-in tools are disabled via `noTools: "builtin"`. Custom tools are exposed through a column-gated `PI_TOOL_GROUPS` registry (read, write, shell, web).

#### Scenario: SDK grep/find/ls enabled alongside custom tools
- **WHEN** `createAgentSession` is called
- **THEN** the session config includes `noTools: "builtin"` AND `tools: ["grep", "find", "ls"]`
- **AND** `customTools: buildPiTools(ctx, harnessCtx)` provides all Railyin tools

#### Scenario: No SDK built-in tools other than search tools
- **WHEN** `createAgentSession` is called
- **THEN** `tools` list SHALL equal exactly `["grep", "find", "ls"]`
- **AND** SDK tools `read`, `write`, `edit`, `bash` SHALL NOT be in the enabled list

## ADDED Requirements

### Requirement: buildSessionOptions helper is extracted
The session options for `createAgentSession` SHALL be constructed by a standalone `buildSessionOptions()` helper that accepts `columnGroups` and returns `{ noTools, tools, customTools }`. This enables clean dependency injection and unit testing of session configuration.

#### Scenario: buildSessionOptions returns correct defaults
- **WHEN** `buildSessionOptions()` is called with `columnGroups: undefined`
- **THEN** it returns `{ noTools: "builtin", tools: ["grep", "find", "ls"], customTools: <from buildAllTools>`

#### Scenario: buildSessionOptions respects columnGroups filtering
- **WHEN** `buildSessionOptions()` is called with `columnGroups: ["read", "write"]`
- **THEN** `customTools` only contains tools from `PI_TOOL_GROUPS.read` + `PI_TOOL_GROUPS.write`
