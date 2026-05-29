## ADDED Requirements

### Requirement: McpRegistryPool resolves global registry
The test suite SHALL verify that `McpRegistryPool.getGlobalRegistry()` returns a registry initialized from the global config file path.

#### Scenario: Global config exists — registry is initialized
- **WHEN** a valid `mcp.json` exists at the global config path
- **THEN** `getGlobalRegistry()` SHALL call the injected factory with the parsed config and return the result

#### Scenario: Global config absent — returns empty registry
- **WHEN** no global config file exists
- **THEN** `getGlobalRegistry()` SHALL call the factory with `{ servers: [] }` and return the result

### Requirement: McpRegistryPool resolves project registry with override
The test suite SHALL verify that `McpRegistryPool.getForProject(projectPath)` returns a project-scoped registry when a project config exists, falling back to global otherwise.

#### Scenario: Project config exists — project registry returned
- **WHEN** `<projectPath>/.railyn/mcp.json` exists
- **THEN** `getForProject(projectPath)` SHALL call the factory with the project config and return a project-specific registry, NOT the global one

#### Scenario: Project config absent — global registry returned
- **WHEN** no `<projectPath>/.railyn/mcp.json` exists
- **THEN** `getForProject(projectPath)` SHALL return the same instance as `getGlobalRegistry()`

### Requirement: McpRegistryPool caches registries per project path
The test suite SHALL verify that repeated calls for the same project path return the same registry instance.

#### Scenario: Same project path called twice returns same instance
- **WHEN** `getForProject(path)` is called twice with the same `path`
- **THEN** the factory SHALL have been called only once, and both calls SHALL return the same registry instance

#### Scenario: Different project paths get separate instances
- **WHEN** `getForProject(pathA)` and `getForProject(pathB)` are called (both with configs)
- **THEN** the factory SHALL have been called twice, returning two distinct registry instances

### Requirement: McpRegistryPool shuts down all cached registries
The test suite SHALL verify that `shutdown()` calls `shutdown()` on every cached registry instance.

#### Scenario: Shutdown propagates to all cached registries
- **WHEN** two project registries have been lazily initialized, then `pool.shutdown()` is called
- **THEN** `shutdown()` SHALL be called on both cached registry instances
