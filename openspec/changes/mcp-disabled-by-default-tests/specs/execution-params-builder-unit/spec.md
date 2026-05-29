## MODIFIED Requirements

### Requirement: enabled_mcp_tools null maps to empty array
`ExecutionParamsBuilder.build()` and `buildForChat()` SHALL treat `null` and missing `enabled_mcp_tools` as `[]` (no tools enabled), not as a sentinel for "all tools".

#### Scenario: null DB value maps to empty array in build()
- **WHEN** `task.enabled_mcp_tools` is `null`
- **THEN** `build()` SHALL return `ExecutionParams` with `enabledMcpTools: []`

#### Scenario: empty JSON array maps to empty array in build()
- **WHEN** `task.enabled_mcp_tools` is `'[]'`
- **THEN** `build()` SHALL return `ExecutionParams` with `enabledMcpTools: []`

#### Scenario: specific tools JSON parses correctly
- **WHEN** `task.enabled_mcp_tools` is `'["server:tool"]'`
- **THEN** `build()` SHALL return `ExecutionParams` with `enabledMcpTools: ["server:tool"]`

#### Scenario: malformed JSON defaults to empty array
- **WHEN** `task.enabled_mcp_tools` contains invalid JSON
- **THEN** `build()` SHALL return `ExecutionParams` with `enabledMcpTools: []` (no throw)

#### Scenario: pool DI — registry resolved from project path
- **WHEN** `ExecutionParamsBuilder` is constructed with an `McpRegistryPool` and `build()` is called with a task that has a `project_key`
- **THEN** `params.mcpRegistry` SHALL be the registry returned by `pool.getForProject(resolvedProjectPath)`

#### Scenario: pool DI — global registry used for chat builds
- **WHEN** `buildForChat()` is called (session context, no project path)
- **THEN** `params.mcpRegistry` SHALL be the registry returned by `pool.getGlobalRegistry()`
