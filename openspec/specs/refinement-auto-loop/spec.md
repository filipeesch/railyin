## Purpose
The refinement harness SHALL support a `--mode auto` flag that drives an autonomous observation→finding→apply→verify loop over mock captures, producing a findings report and optionally validating structural improvements with a behavioral gate in local mode.

## Requirements

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

### Requirement: Finding generation step
After the baseline run, the runner SHALL write a prompt-accessible summary of all capture files and baseline metrics, then await a Finding array (JSON) as input. This is the step where the AI reads captures and emits `Finding[]`.

#### Scenario: Runner writes capture summary for AI analysis
- **WHEN** the baseline completes
- **THEN** the runner writes `reports/<timestamp>-auto/capture-summary.json` containing: per-scenario token averages (tools_tokens, system_tokens, messages_tokens), cache_hit_ratio, total_cost, and the path of each request capture file

#### Scenario: AI reads captures and emits findings
- **WHEN** the runner is waiting for findings input
- **THEN** the AI reads capture-summary.json plus individual request JSON files, performs per-finding doc search, and returns a JSON array of Finding objects

### Requirement: Single-finding apply/verify iteration
The runner SHALL apply findings one at a time. For each finding: (1) backup the changed files, (2) apply the change, (3) re-run mock scenarios, (4) evaluate metric contract and assertions, (5) confirm or rollback, (6) update finding status. No two findings SHALL be applied simultaneously.

#### Scenario: One finding applied per iteration
- **WHEN** the findings array has 6 pending findings
- **THEN** the runner applies finding F001, re-runs, confirms or rolls back, then proceeds to F002, never applying two findings at once

#### Scenario: Confirmed finding is not rolled back in subsequent iterations
- **WHEN** finding F001 is confirmed and finding F002 is later rolled back
- **THEN** F001's changes remain in place; only F002's changes are reverted

#### Scenario: File backup created before applying a finding
- **WHEN** a finding targets changes to `src/bun/ai/anthropic.ts`
- **THEN** the runner writes the current content of `src/bun/ai/anthropic.ts` to `reports/<timestamp>-auto/backups/F001/anthropic.ts` before applying the change

### Requirement: Rollback mechanics
When a finding does not satisfy its metric contract OR any previously-passing assertion fails, the runner SHALL restore all files touched by that finding from the backup, update the finding status to "rolled_back", and proceed to the next pending finding.

#### Scenario: Rollback restores files from backup
- **WHEN** a finding is rolled back
- **THEN** the runner reads each backed-up file from the `backups/<id>/` directory and writes it back to its original path

#### Scenario: Rollback does not affect previously confirmed findings
- **WHEN** F002 is rolled back after F001 was confirmed
- **THEN** the files changed by F001 retain the confirmed changes

#### Scenario: Rollback triggered by assertion regression even with metric improvement
- **WHEN** a finding improves total_cost by 20% but causes a previously-passing assertion to fail
- **THEN** the finding is rolled back and status set to "rolled_back"

### Requirement: Stopping conditions
The loop SHALL stop when one of the following conditions is met:
1. No pending findings remain
2. The last 3 rounds each produced < 1% improvement in `total_cost` (plateau detection)
3. A hard `--max-rounds N` cap is reached (default: unlimited)

#### Scenario: Loop stops when no pending findings remain
- **WHEN** all findings in the findings array have status confirmed, rolled_back, or ineffective
- **THEN** the loop exits and writes the findings report

#### Scenario: Loop stops on plateau after 3 rounds
- **WHEN** rounds 4, 5, and 6 each produce < 1% total_cost improvement vs. the previous round
- **THEN** the loop exits after round 6

#### Scenario: --max-rounds caps iterations
- **WHEN** the runner is invoked with `--mode auto --max-rounds 3` and there are 10 pending findings
- **THEN** the loop stops after 3 rounds regardless of remaining pending findings

### Requirement: Per-finding Anthropic doc search
For each finding the AI generates, it SHALL perform a targeted `search_internet` query for the specific optimization topic, then `fetch_url` for the most relevant result page. The fetched content SHALL be used to ground the evidence.doc_reference and evidence.doc_quote fields.

#### Scenario: Doc search is per-finding, not cached
- **WHEN** F001 targets tool description verbosity and F002 targets cache prefix stability
- **THEN** two separate `search_internet` calls are made, one for each finding's topic

#### Scenario: Doc search is skipped if finding already has a reference
- **WHEN** the AI emits a finding with a pre-populated evidence.doc_reference
- **THEN** the runner does not override the reference and skips the search step for that finding

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

### Requirement: Findings report written incrementally
The findings report file SHALL be updated after each finding's status is resolved (confirmed, rolled_back, or ineffective), not only at the end of the loop. This ensures the report reflects progress even if the loop is interrupted.

#### Scenario: Findings report updated after each finding
- **WHEN** F001 is confirmed
- **THEN** findings-report.json is written immediately, showing F001 as confirmed and F002–F006 as pending

#### Scenario: Interrupted loop has a usable partial report
- **WHEN** the loop is killed after 3 of 6 findings are processed
- **THEN** findings-report.json reflects the final status of those 3 findings

### Requirement: ProxyMode includes "auto"
The `ProxyMode` type in `refinement/types.ts` SHALL include `"auto"` as a valid value. The auto mode SHALL NOT be passed to `createProxy()` — it is consumed entirely at the runner level; proxy calls within the loop use `"mock"` and optionally `"local"`.

#### Scenario: ProxyMode type accepts "auto"
- **WHEN** TypeScript compiles runner.ts with `const mode: ProxyMode = "auto"`
- **THEN** the TypeScript compiler emits no type error

#### Scenario: createProxy is never called with mode "auto"
- **WHEN** the runner is in auto loop mode
- **THEN** all `createProxy()` calls within the loop use `"mock"` or `"local"` as the mode argument, never `"auto"`
