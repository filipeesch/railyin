## ADDED Requirements

### Requirement: Multi-mode collection pipeline
The auto loop SHALL collect baseline data from all three modes (mock, local, live) before entering the analysis phase. Collection order SHALL be: mock first (fast, deterministic), then local, then live. If a backend is unavailable for a mode (no LM Studio for local, no API key for live), that mode SHALL be skipped with a warning.

#### Scenario: All three modes collected when backends available
- **WHEN** the auto loop starts and LM Studio is running and an Anthropic API key is set
- **THEN** the runner collects mock baseline, then local baseline (2 runs per scenario), then live baseline (2 runs per scenario)

#### Scenario: Live mode skipped when no API key
- **WHEN** the auto loop starts and no `ANTHROPIC_API_KEY` environment variable is set
- **THEN** the runner collects mock and local baselines, skips live with a warning `[auto] skipping live mode: no ANTHROPIC_API_KEY set`, and proceeds to analysis with mock + local data only

#### Scenario: Local mode skipped when no model loaded
- **WHEN** the auto loop starts and `lms ps` shows no loaded model
- **THEN** the runner skips local mode with a warning and proceeds with available modes

### Requirement: Configurable model per mode
The runner SHALL accept `--local-model <id>` and `--live-model <id>` flags to specify which model to use for each mode. Defaults SHALL be: local auto-detects from LM Studio, live uses `anthropic/claude-sonnet-4-20250514`.

#### Scenario: Custom live model specified
- **WHEN** the runner is invoked with `--live-model anthropic/claude-opus-4-20250514`
- **THEN** all live mode requests use `anthropic/claude-opus-4-20250514` as the model ID

#### Scenario: Local model auto-detected
- **WHEN** the runner is invoked without `--local-model` and LM Studio is running `qwen/qwen3.5-9b`
- **THEN** the runner uses `qwen/qwen3.5-9b` as the local model ID

#### Scenario: Default live model
- **WHEN** the runner is invoked without `--live-model`
- **THEN** the runner uses `anthropic/claude-sonnet-4-20250514` as the model

### Requirement: Model name stored in run report
The `RunReport` SHALL include a `model` field containing the model ID used for that mode's run. Each `ScenarioReport` SHALL also include the `model` field.

#### Scenario: Report contains model name
- **WHEN** a local mode run completes using `qwen/qwen3.5-9b`
- **THEN** the `RunReport` has `model: "qwen/qwen3.5-9b"` and each `ScenarioReport` has `model: "qwen/qwen3.5-9b"`

### Requirement: Multi-mode report directory structure
The auto loop SHALL organize reports in a per-mode subdirectory structure:
```
reports/<timestamp>-auto/
  mock/report.json, requests/...
  local/report.json, requests/..., behavioral.json
  live/report.json, requests/..., behavioral.json
  analysis.json
```

#### Scenario: Report directory has per-mode subdirectories
- **WHEN** the auto loop completes with all three modes
- **THEN** the report directory contains `mock/`, `local/`, and `live/` subdirectories, each with their own `report.json` and `requests/` directory

### Requirement: Cross-mode analysis phase
After collecting all modes, the auto loop SHALL generate an `analysis.json` comparing data across modes. The analysis SHALL include: token cost comparison (mock vs live), tool sequence comparison (local vs live), round trip comparison (local vs live), timing summary (local and live), completion rates (local and live), variance between runs (local and live).

#### Scenario: Analysis compares tool sequences across models
- **WHEN** local mode (9B model) uses sequence `[search_text, read_file, read_file, edit_file]` and live mode (Sonnet) uses `[search_text, read_file, edit_file]`
- **THEN** `analysis.json` notes the extra `read_file` call in local mode for that scenario

#### Scenario: Analysis flags high variance scenarios
- **WHEN** a scenario shows 3 rounds in run-1 and 7 rounds in run-2 for local mode
- **THEN** `analysis.json` flags the scenario as `high_variance: true` with `rounds_variance > 50%`

#### Scenario: Analysis compares costs across modes
- **WHEN** mock mode estimates `$0.019` and live mode (with real output tokens) costs `$0.024`
- **THEN** `analysis.json` includes `cost_delta_mock_vs_live: $0.005` and notes the output token difference

### Requirement: Skip-live flag
The runner SHALL accept a `--skip-live` flag that excludes live mode from the collection pipeline. This is the default for iterative development to avoid real API costs.

#### Scenario: Skip live mode
- **WHEN** the runner is invoked with `--skip-live`
- **THEN** only mock and local baselines are collected; live mode is skipped without warning

### Requirement: Remove --eval-mode flag
The `--eval-mode` flag SHALL be removed from the runner. The auto loop always collects all available modes. The `--mode auto` invocation replaces the previous `--mode auto --eval-mode local` pattern.

#### Scenario: --eval-mode is not accepted
- **WHEN** the runner is invoked with `--mode auto --eval-mode local`
- **THEN** the runner prints an error: `--eval-mode is no longer supported; auto mode collects all available modes` and exits with code 1
