## ADDED Requirements

### Requirement: Runner orchestrates scenario execution
The system SHALL provide a CLI entry point (`refinement/runner.ts`) that accepts `--mode` (mock/local/live), `--port` (proxy port, default 8999), `--backend` (backend URL), and `--scenario` (optional, specific scenario file). It SHALL start the proxy, load scenarios, execute them sequentially, collect inspection records and assertion results, and produce a report.

#### Scenario: Full run in mock mode
- **WHEN** `bun refinement/runner.ts --mode mock` is executed
- **THEN** the runner starts the proxy in mock mode, runs all scenarios in `refinement/scenarios/`, evaluates assertions, and outputs a report JSON to `refinement/reports/`

#### Scenario: Single scenario run
- **WHEN** `bun refinement/runner.ts --mode mock --scenario edit-file-flow`
- **THEN** only the `edit-file-flow.yaml` scenario is executed

### Requirement: Runner produces JSON report files
After each run, the system SHALL write a report file to `refinement/reports/<timestamp>-<mode>.json` containing: mode, timestamp, scenarios executed, per-scenario assertion results (pass/fail with details), aggregated metrics (tools_count, tools_hash values, cache_hit_ratio, max_tokens values), and overall pass/fail status.

#### Scenario: Report file created after successful run
- **WHEN** a mock mode run completes with 3 scenarios (2 pass, 1 fail)
- **THEN** a report file is created with `{ mode: "mock", pass: false, scenarios: [...], metrics: {...} }`

### Requirement: Runner compares reports for regression detection
The system SHALL support a `--compare <path>` flag that loads a baseline report and diffs it against the current run. For each metric present in both reports, the runner SHALL determine if the value improved, regressed, or stayed the same. A regression in any assertion-covered metric SHALL cause the overall comparison to fail.

#### Scenario: Comparison detects improvement
- **WHEN** baseline has `cache_hit_ratio: 0` and current run has `cache_hit_ratio: 0.85`
- **THEN** the comparison reports `cache_hit_ratio: improved (+0.85)` and overall status is pass

#### Scenario: Comparison detects regression
- **WHEN** baseline has `tools_count: 21` and current run has `tools_count: 24`
- **THEN** the comparison reports `tools_count: regressed (+3)` and overall status is fail

### Requirement: Runner drives the engine headlessly for scenario execution
In mock mode, the scenario player in the proxy handles responses directly. In local and live modes, the runner SHALL import the engine module and execute the scenario's user prompt programmatically, using the proxy as the configured provider endpoint. Tool execution SHALL proceed against the real filesystem (or a sandboxed temp directory).

#### Scenario: Local mode engine execution
- **WHEN** running in local mode with a scenario that sends "Change foo to bar in src/main.ts"
- **THEN** the engine executes against the local model via the proxy, calling tools and collecting the model's responses

#### Scenario: Mock mode uses proxy script directly
- **WHEN** running in mock mode
- **THEN** the runner sends the scenario's user message to the engine, which calls the proxy, and the proxy returns scripted responses without forwarding to any backend
