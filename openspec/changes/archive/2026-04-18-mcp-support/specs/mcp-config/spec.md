## ADDED Requirements

### Requirement: MCP config file location and merge
The system SHALL load MCP server configuration from two locations: `~/.railyin/mcp.json` (global) and `<project.path>/.railyin/mcp.json` (project-level). When both exist, they SHALL be merged by server name, with project-level entries overriding global entries of the same name.

#### Scenario: Project config only
- **WHEN** only `<project.path>/.railyin/mcp.json` exists
- **THEN** the system loads servers from that file only

#### Scenario: Global config only
- **WHEN** only `~/.railyin/mcp.json` exists and no project config exists
- **THEN** the system loads servers from the global file only

#### Scenario: Both configs exist
- **WHEN** both `~/.railyin/mcp.json` and `<project.path>/.railyin/mcp.json` exist with overlapping server names
- **THEN** the project-level entry replaces the global entry for that server name, and non-overlapping entries from both files are included

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
