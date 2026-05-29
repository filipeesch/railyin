# mcp-registry-pool Specification

## Purpose
TBD - created by archiving change mcp-disabled-by-default. Update Purpose after archive.
## Requirements
### Requirement: McpRegistryPool manages multiple registry instances
A `McpRegistryPool` class SHALL manage one `McpClientRegistry` per project path plus one global registry. It SHALL expose a `getRegistry(projectPath?: string)` method that returns the appropriate registry instance and lazily initializes it if needed. The pool SHALL be the single injectable entry point for registry access at the app layer.

#### Scenario: Get global registry (no project)
- **WHEN** `pool.getRegistry()` is called without a project path
- **THEN** the global `McpClientRegistry` (loaded from `~/.railyn/mcp.json`) is returned

#### Scenario: Get project registry (first call)
- **WHEN** `pool.getRegistry(projectPath)` is called for a project path with no cached registry
- **THEN** a new `McpClientRegistry` is initialized from `<projectPath>/.railyn/mcp.json` (if present) and cached under that path

#### Scenario: Get project registry (cached)
- **WHEN** `pool.getRegistry(projectPath)` is called for an already-initialized project path
- **THEN** the cached registry is returned immediately without re-initialization

#### Scenario: Project path has no config file
- **WHEN** `pool.getRegistry(projectPath)` is called and `<projectPath>/.railyn/mcp.json` does not exist
- **THEN** the global registry is returned as a fallback (project has no project-level servers)

#### Scenario: Pool shutdown
- **WHEN** `pool.shutdown()` is called
- **THEN** all managed registry instances call their own `shutdown()` methods to terminate server processes

