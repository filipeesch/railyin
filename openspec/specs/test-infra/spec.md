# Spec: test-infra

## Purpose

Specifies the shared test infrastructure helpers used across the multi-engine backend test suite — `BackendRpcRuntime` engine injection, `setupTestConfig` with engines YAML support, and DB schema requirements.

## Requirements

### Requirement: BackendRpcRuntime-engine-injection
`BackendRpcRuntime` accepts an injected `EngineRegistry` instead of a `createEngine` callback.

#### Scenario: TI-1 single engine runtime via makeRegistry helper
- **WHEN** `createBackendRpcRuntime({ engineRegistry: makeRegistry(mockEngine, getConfig), ... })` is called
- **THEN** runtime is created successfully and routes all executions through `mockEngine`

#### Scenario: TI-2 multi-engine runtime via direct Map injection
- **WHEN** `createBackendRpcRuntime({ engineRegistry: new EngineRegistry(new Map([["copilot", e1], ["claude", e2]]), getConfig), ... })` is called
- **THEN** runtime routes copilot-model executions to `e1` and claude-model executions to `e2`

---

### Requirement: SetupTestConfig-engines-yaml
`setupTestConfig()` accepts an optional `enginesYaml` string and writes it to `RAILYN_CONFIG_DIR`.

#### Scenario: TI-3 enginesYaml written to configDir
- **WHEN** `setupTestConfig({ enginesYaml: "engines:\n  - id: copilot..." })` is called
- **THEN** a file `engines.yaml` exists in the test config directory and `loadEnginesConfig()` reads it

#### Scenario: TI-4 absent enginesYaml leaves only workspace.yaml
- **WHEN** `setupTestConfig({})` is called without `enginesYaml`
- **THEN** no `engines.yaml` is written; backward compat fallback is used

---

### Requirement: InitDb-last-engine-type
`initDb()` includes the `last_engine_type TEXT NULL` column in the `conversations` table.

#### Scenario: TI-5 last_engine_type column exists after initDb
- **WHEN** `initDb()` is called
- **THEN** `conversations` table has a nullable `last_engine_type` column
