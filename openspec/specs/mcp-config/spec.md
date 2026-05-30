## Purpose
Defines how MCP server configuration is loaded, normalized, and resolved from global (`~/.railyn/mcp.json`) and project-level (`<project.path>/.railyn/mcp.json`) config files. When a project config exists, it fully overrides the global config for that project's tasks.
## Requirements
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

### Requirement: stdio server config schema
The system SHALL support stdio-type MCP servers defined with `command`, `args` (array), and optional `env` (object of additional environment variables) fields.

#### Scenario: Valid stdio config
- **WHEN** a server entry has `"type": "stdio"`, a `"command"` string, and an `"args"` array
- **THEN** the system accepts the config and adds the server to the registry

#### Scenario: Environment variable interpolation
- **WHEN** a config value contains `${VAR_NAME}` and `VAR_NAME` is set in the process environment
- **THEN** the system substitutes the variable value before using the config

### Requirement: HTTP server config schema
The system SHALL support HTTP-type MCP servers defined with a `url` string and optional `headers` object.

#### Scenario: Valid HTTP config
- **WHEN** a server entry has `"type": "http"` and a `"url"` string
- **THEN** the system accepts the config and adds the server to the registry

#### Scenario: Auth header with env var
- **WHEN** a headers value contains `${TOKEN}` and `TOKEN` is set in the environment
- **THEN** the interpolated header value is used in HTTP requests to the server

### Requirement: Shared config normalization via config-loader
A dedicated `src/bun/mcp/config-loader.ts` module SHALL provide `normalizeToMcpConfig(raw)` and `loadMcpConfigFile(path)` functions. All config loading — at boot and in RPC handlers — SHALL use this shared module.

#### Scenario: Boot loads via config-loader
- **WHEN** the application starts
- **THEN** `loadMcpConfigFile` is called from `config-loader.ts`, not from duplicated inline code

#### Scenario: RPC save uses same normalization
- **WHEN** `mcp.saveConfig` or `mcp.saveProjectConfig` is called
- **THEN** the saved content is normalized via `normalizeToMcpConfig` from `config-loader.ts`

