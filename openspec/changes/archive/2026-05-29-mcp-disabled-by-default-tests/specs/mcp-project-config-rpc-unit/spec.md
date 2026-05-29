## ADDED Requirements

### Requirement: mcp.getProjectConfig returns project config content
The test suite SHALL verify that `mcp.getProjectConfig` resolves the project path via the injected resolver and returns the file content (or a template if absent).

#### Scenario: Project config exists — content returned
- **WHEN** `mcp.getProjectConfig({ workspaceKey, projectKey })` is called and the resolved `<projectPath>/.railyn/mcp.json` exists
- **THEN** the handler SHALL return `{ path: "<projectPath>/.railyn/mcp.json", content: "<file contents>" }`

#### Scenario: Project config absent — empty template returned
- **WHEN** the resolved project config file does not exist
- **THEN** the handler SHALL return `{ path: "<projectPath>/.railyn/mcp.json", content: '{ "servers": [] }' }` (or equivalent empty template)

#### Scenario: Unknown project key — throws
- **WHEN** the injected resolver cannot find the project for the given `workspaceKey` + `projectKey`
- **THEN** the handler SHALL throw an error with a descriptive message

### Requirement: mcp.saveProjectConfig writes and validates project config
The test suite SHALL verify that `mcp.saveProjectConfig` validates JSON, creates the directory if needed, writes the file, and triggers a registry reload for that project path.

#### Scenario: Valid JSON is written to disk
- **WHEN** `mcp.saveProjectConfig({ workspaceKey, projectKey, content: validJson })` is called
- **THEN** the file SHALL be written to `<projectPath>/.railyn/mcp.json` with the provided content

#### Scenario: .railyn directory is created if absent
- **WHEN** `<projectPath>/.railyn/` does not exist
- **THEN** the handler SHALL create the directory before writing the file

#### Scenario: Invalid JSON throws before writing
- **WHEN** `content` is not valid JSON
- **THEN** the handler SHALL throw a `SyntaxError` and SHALL NOT write to disk

#### Scenario: Registry pool is invalidated after save
- **WHEN** a valid config is saved
- **THEN** the injected `registryPool` SHALL have its cache for that `projectPath` invalidated (so the next execution picks up the new config)
