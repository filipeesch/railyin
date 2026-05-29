## MODIFIED Requirements

### Requirement: MCP config file location and merge
The system SHALL load MCP server configuration from two locations: `~/.railyn/mcp.json` (global) and `<project.path>/.railyn/mcp.json` (project-level). When a project-level config exists, it SHALL completely replace the global config for that project's tasks. No merging occurs — the project config is the sole source of servers for that scope.

#### Scenario: Project config only
- **WHEN** only `<project.path>/.railyn/mcp.json` exists
- **THEN** the system loads servers from that file only

#### Scenario: Global config only
- **WHEN** only `~/.railyn/mcp.json` exists and no project config exists
- **THEN** the system loads servers from the global file only

#### Scenario: Both configs exist
- **WHEN** both `~/.railyn/mcp.json` and `<project.path>/.railyn/mcp.json` exist
- **THEN** the project-level config is used exclusively; global servers are ignored entirely for that project

#### Scenario: No config exists
- **WHEN** neither global nor project config file exists
- **THEN** no MCP servers are loaded and the registry remains empty with no error

## MODIFIED Requirements

### Requirement: Shared config normalization via config-loader
A dedicated `src/bun/mcp/config-loader.ts` module SHALL provide `normalizeToMcpConfig(raw)` and `loadMcpConfigFile(path)` functions. All config loading — at boot and in RPC handlers — SHALL use this shared module.

#### Scenario: Boot loads via config-loader
- **WHEN** the application starts
- **THEN** `loadMcpConfigFile` is called from `config-loader.ts`, not from duplicated inline code

#### Scenario: RPC save uses same normalization
- **WHEN** `mcp.saveConfig` or `mcp.saveProjectConfig` is called
- **THEN** the saved content is normalized via `normalizeToMcpConfig` from `config-loader.ts`
