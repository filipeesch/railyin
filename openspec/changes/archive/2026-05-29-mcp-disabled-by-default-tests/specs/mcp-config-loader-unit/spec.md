## ADDED Requirements

### Requirement: normalizeToMcpConfig handles all input shapes
The test suite SHALL verify that `normalizeToMcpConfig` (extracted to `src/bun/mcp/config-loader.ts`) converts every valid and invalid input shape into a well-formed `McpConfig` without throwing.

#### Scenario: Empty or null input returns empty server list
- **WHEN** `normalizeToMcpConfig` is called with `null`, `undefined`, `{}`, or an object without a `servers` key
- **THEN** it SHALL return `{ servers: [] }`

#### Scenario: Array-format passthrough
- **WHEN** input is `{ servers: [{ name: "s1", transport: {...} }] }`
- **THEN** it SHALL return the array unchanged as `{ servers: [...] }`

#### Scenario: VS Code object-map conversion — stdio entry
- **WHEN** input is `{ servers: { "my-server": { command: "node", args: ["index.js"], env: { FOO: "bar" } } } }`
- **THEN** it SHALL return `{ servers: [{ name: "my-server", transport: { type: "stdio", command: "node", args: ["index.js"], env: { FOO: "bar" } } }] }`

#### Scenario: VS Code object-map conversion — http entry
- **WHEN** input is `{ servers: { "remote": { url: "https://api.example.com/mcp", headers: { Authorization: "Bearer x" } } } }`
- **THEN** it SHALL return `{ servers: [{ name: "remote", transport: { type: "http", url: "https://api.example.com/mcp", headers: { Authorization: "Bearer x" } } }] }`

#### Scenario: Multiple servers in object-map
- **WHEN** input has multiple keys in the `servers` object
- **THEN** every key SHALL become a separate server entry with the key as the `name` field

### Requirement: loadMcpConfigFile reads and normalizes a JSON file
The test suite SHALL verify that `loadMcpConfigFile(path)` reads the file at the given path and returns a normalized `McpConfig`.

#### Scenario: File does not exist returns empty config
- **WHEN** `loadMcpConfigFile` is called with a path that does not exist on disk
- **THEN** it SHALL return `{ servers: [] }` without throwing

#### Scenario: Valid JSON file is parsed and normalized
- **WHEN** a valid JSON file exists at the given path
- **THEN** it SHALL return the normalized `McpConfig` equivalent

#### Scenario: Invalid JSON file throws
- **WHEN** the file at the given path contains malformed JSON
- **THEN** `loadMcpConfigFile` SHALL throw a `SyntaxError`
