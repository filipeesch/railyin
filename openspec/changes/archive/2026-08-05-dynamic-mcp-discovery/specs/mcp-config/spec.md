## MODIFIED Requirements

### Requirement: Shared config normalization via config-loader
A dedicated `src/bun/mcp/config-loader.ts` module SHALL provide `normalizeToMcpConfig(raw)` and `loadMcpConfigFile(path)` functions. All config loading — at boot and in RPC handlers — SHALL use this shared module. `normalizeToMcpConfig` SHALL preserve `description` and `enabled` fields for servers regardless of whether the source config uses the array format (`{"servers": [...]}`) or the VS Code object-map format (`{"servers": {"name": {...}}}`).

#### Scenario: Boot loads via config-loader
- **WHEN** the application starts
- **THEN** `loadMcpConfigFile` is called from `config-loader.ts`, not from duplicated inline code

#### Scenario: RPC save uses same normalization
- **WHEN** `mcp.saveConfig` or `mcp.saveProjectConfig` is called
- **THEN** the saved content is normalized via `normalizeToMcpConfig` from `config-loader.ts`

#### Scenario: Object-map format preserves description
- **WHEN** a config uses the object-map format and a server entry has a `"description"` field
- **THEN** `normalizeToMcpConfig` includes that `description` on the resulting `McpServerConfig`, not dropping it

#### Scenario: Object-map format preserves enabled flag
- **WHEN** a config uses the object-map format and a server entry has `"enabled": false`
- **THEN** `normalizeToMcpConfig` includes `enabled: false` on the resulting `McpServerConfig`, so the registry correctly marks that server `disabled` instead of defaulting it to enabled
