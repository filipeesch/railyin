## ADDED Requirements

### Requirement: Config singleton supports runtime reload without restart
The system SHALL expose a `reloadConfig()` function that clears the in-memory config singleton and forces a fresh read from disk on the next access. This SHALL be callable at runtime from RPC handlers without restarting the process.

#### Scenario: reloadConfig clears the in-memory singleton
- **WHEN** `reloadConfig()` is called
- **THEN** the internal `_config` singleton is reset to null and the next call to `getConfig()` re-reads all YAML files from disk
