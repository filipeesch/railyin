## MODIFIED Requirements

### Requirement: --mode auto entry point in runner
The runner SHALL accept `--mode auto` as a valid entry point. When invoked, it SHALL load providers from `config/providers.yaml`, select providers via `--providers` flag (or `default_providers`), and run the baseline → finding → apply → verify loop using the selected providers instead of hardcoded mock/local/live modes. For each provider, it SHALL create a worktree (if non-mock), run all selected scenarios for `runs_per_scenario` iterations, and collect metrics per provider.

#### Scenario: --mode auto loads providers from YAML
- **WHEN** the user runs `bun run refinement/runner.ts --mode auto`
- **THEN** the runner loads `config/providers.yaml` and uses `default_providers` for the baseline run

#### Scenario: --mode auto with explicit providers
- **WHEN** the user runs `bun run refinement/runner.ts --mode auto --providers lmstudio-qwen,mock-default`
- **THEN** the runner runs the auto loop using only the `lmstudio-qwen` and `mock-default` providers

#### Scenario: --mode auto exits with non-zero if baseline fails
- **WHEN** the initial baseline run has any assertion failures for any provider
- **THEN** the runner exits with code 1 and prints "Baseline has failing assertions — fix before running --mode auto"

### Requirement: Behavioral gate (Phase 2, local mode)
After the structural loop stabilizes, the runner SHALL optionally run a behavioral validation pass using a designated provider instead of requiring a specific `local` mode. The provider used for behavioral gating SHALL be configurable via `behavioral_provider` in providers.yaml. If no `behavioral_provider` is configured, the runner SHALL use the first `lmstudio` provider. If no lmstudio provider is available, behavioral gating is skipped.

#### Scenario: Behavioral gate uses configured provider
- **WHEN** the structural loop completes and `behavioral_provider: lmstudio-qwen` is set in providers.yaml
- **THEN** the runner runs behavioral validation using the `lmstudio-qwen` provider

#### Scenario: Behavioral gate falls back to first lmstudio provider
- **WHEN** no `behavioral_provider` is configured and providers include `lmstudio-qwen`
- **THEN** the runner uses `lmstudio-qwen` for behavioral validation

#### Scenario: Behavioral gate is skipped if no local provider available
- **WHEN** no `behavioral_provider` is configured and no lmstudio providers exist in providers.yaml
- **THEN** the runner skips behavioral validation and writes `behavioral_gate: "skipped"` in the findings report

### Requirement: Per-provider baseline metrics
The baseline phase SHALL collect separate metric sets per provider. Each provider's baseline includes: per-scenario token averages, cache_hit_ratio, total_cost, timing, and rounds. Cross-provider comparison is informational and included in the report but not used for finding generation.

#### Scenario: Baseline collects metrics per provider
- **WHEN** the auto loop runs baseline with providers `mock-default` and `lmstudio-qwen`
- **THEN** the capture summary contains separate metric sections for each provider

#### Scenario: Cross-provider comparison in report
- **WHEN** baseline completes for 2 providers on the same scenario
- **THEN** the report includes a cross-provider comparison table showing token counts, cost, and timing side-by-side

### Requirement: Same-model variance detection
The runner SHALL execute each scenario `runs_per_scenario` times (default 2) per provider. The report SHALL include per-scenario variance metrics: standard deviation of total_cost, rounds, and total_tokens across runs of the same provider.

#### Scenario: Two runs per scenario by default
- **WHEN** `runs_per_scenario: 2` is set in providers.yaml and scenario `export-markdown` runs for provider `lmstudio-qwen`
- **THEN** the scenario executes twice and both run results are recorded

#### Scenario: Variance metrics in report
- **WHEN** two runs of `export-markdown` for `lmstudio-qwen` produce total_cost of $0.012 and $0.015
- **THEN** the report shows mean=$0.0135, stddev=$0.0015 for that scenario-provider pair
