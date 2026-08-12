## MODIFIED Requirements

### Requirement: McpRegistryPool manages multiple registry instances
A `McpRegistryPool` SHALL manage one `McpClientRegistry` per project path plus one global registry, and SHALL expose a method that returns the appropriate registry for a project path, lazily initializing it from `<projectPath>/.railyn/mcp.json` if present. On first creation of a project registry, the pool SHALL fire `ensureStarted()` asynchronously so its servers transition `idle` → `starting` → `running` before the execution's discovery tools operate. Cached project registries SHALL be returned without re-initialization or re-start.

#### Scenario: Get global registry (no project)
- **WHEN** a registry is requested without a project path
- **THEN** the global `McpClientRegistry` (loaded from the global `mcp.json`) is returned

#### Scenario: Get project registry (first call)
- **WHEN** a registry is requested for a project path with no cached registry and `<projectPath>/.railyn/mcp.json` exists
- **THEN** a new `McpClientRegistry` is initialized from that file, cached, and `ensureStarted()` is fired so servers reach `running` before use

#### Scenario: Get project registry (cached)
- **WHEN** a registry is requested for an already-initialized project path
- **THEN** the cached registry is returned immediately without re-initialization or re-start

#### Scenario: Pool shutdown
- **WHEN** `pool.shutdown()` is called
- **THEN** all distinct managed registries call `shutdown()` to terminate server processes
