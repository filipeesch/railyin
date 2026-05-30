## MODIFIED Requirements

### Requirement: Get project MCP config via RPC
The system SHALL expose a `mcp.getProjectConfig` RPC method that reads `<projectPath>/.railyn/mcp.json` for a given workspace and project key, returning the file path and raw content string.

#### Scenario: Project config exists
- **WHEN** `mcp.getProjectConfig({ workspaceKey, projectKey })` is called and the file exists
- **THEN** the response includes the absolute file path and the JSON string content

#### Scenario: Project config does not exist
- **WHEN** `mcp.getProjectConfig({ workspaceKey, projectKey })` is called and the file does not exist
- **THEN** the response includes the file path and an empty JSON object `{}` as the default content

### Requirement: Save project MCP config via RPC
The system SHALL expose a `mcp.saveProjectConfig` RPC method that writes the provided JSON content to `<projectPath>/.railyn/mcp.json`, creates the `.railyn/` directory if absent, and triggers a reload of the project's registry.

#### Scenario: Save valid JSON config
- **WHEN** `mcp.saveProjectConfig({ workspaceKey, projectKey, content })` is called with valid JSON
- **THEN** the file is written to `<projectPath>/.railyn/mcp.json` and the project's `McpClientRegistry` is reloaded

#### Scenario: Save creates directory if absent
- **WHEN** `mcp.saveProjectConfig` is called and `<projectPath>/.railyn/` does not exist
- **THEN** the directory is created before writing the file

#### Scenario: Save invalid JSON rejected
- **WHEN** `mcp.saveProjectConfig` is called with content that is not valid JSON
- **THEN** the server returns an error and the file is not written
