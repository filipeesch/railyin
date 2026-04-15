# tool-result-file-changes Specification

## Purpose
TBD - created by archiving change write-tools-response-abstraction. Update Purpose after archive.
## Requirements
### Requirement: Tool results expose structured file-change payloads
The system SHALL allow `tool_result` events and persisted tool-result messages to include a structured `writtenFiles` payload describing file changes produced by that tool call. `writtenFiles` entries SHALL include file identity (`path`), operation type, and change details sufficient for UI rendering.

#### Scenario: Tool result includes structured file changes
- **WHEN** a tool call changes one or more files
- **THEN** the corresponding `tool_result` contains `writtenFiles` with one entry per changed file

#### Scenario: Tool result omits file changes when none occurred
- **WHEN** a tool call does not change any files
- **THEN** the corresponding `tool_result` omits `writtenFiles` or provides an empty list

### Requirement: WrittenFile entries align with shared diff semantics
Each `WrittenFile` in `writtenFiles` SHALL follow the shared diff semantics used by the UI, including `path`, `operation`, `added`, `removed`, and optional `hunks`, `to_path`, and `is_new` fields.

#### Scenario: Hunk-capable tools provide hunk detail
- **WHEN** an engine can determine hunk-level edits for a changed file
- **THEN** the `WrittenFile` entry includes `hunks` with line-level added/removed/context information

#### Scenario: Partial detail is still valid
- **WHEN** an engine can determine changed paths but cannot extract reliable hunks
- **THEN** it still emits `WrittenFile` entries with available fields and omits unavailable optional fields

