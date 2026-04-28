# Test Infrastructure

## Purpose

Shared test helpers and utilities used across the backend test suite.

## Requirements

### Requirement: Test infrastructure supports workspace-relative project paths

The test helper `setupTestConfig` SHALL create a real `workspacePath` subdirectory inside the temp `configDir` and write YAML with `workspace_path` set and `project_path` as a relative path. It SHALL return `workspacePath` in its result object so new tests can assert resolved paths.

#### Scenario: setupTestConfig creates valid relative-path config

- **WHEN** `setupTestConfig` is called
- **THEN** the written YAML SHALL contain a relative `project_path` (e.g. `test-project`) and a `workspace_path` pointing to `${configDir}/workspace`
- **AND** `loadConfig()` on the produced config SHALL succeed without errors

#### Scenario: Existing callers are unaffected

- **WHEN** existing backend test files call `setupTestConfig` without using the `workspacePath` return value
- **THEN** all tests SHALL continue to pass without call-site changes
