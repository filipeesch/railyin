## Purpose
The refinement harness SHALL support a `--mode auto` flag that drives an autonomous observation→finding→apply→verify loop over mock captures, producing a findings report and optionally validating structural improvements with a behavioral gate in local mode.

## Requirements

### Requirement: --mode auto entry point in runner
The runner SHALL accept `--mode auto` as a valid ProxyMode value. When invoked, it SHALL run an initial baseline report in mock mode, then enter the finding generation and apply/verify loop, and write the findings report on completion.

#### Scenario: --mode auto runs baseline first
- **WHEN** the user runs `bun run refinement/runner.ts --mode auto`
- **THEN** the runner executes a full mock run (all scenarios) and stores the result as the baseline before any findings are generated

#### Scenario: --mode auto exits with non-zero if baseline fails
- **WHEN** the initial baseline mock run has any assertion failures
- **THEN** the runner exits with code 1 and prints "Baseline has failing assertions — fix before running --mode auto"

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
After the structural mock loop stabilizes (all pending findings processed), the runner SHALL optionally run a local mode validation pass. If a local model is available (`lms ps` finds a loaded model), the runner re-runs all scenarios through local inference and checks for assertion regressions. If any behavioral assertion fails, all confirmed structural findings are reported but flagged as "unvalidated".

#### Scenario: Behavioral gate runs if local model is available
- **WHEN** the structural loop completes and `lms ps` shows a loaded model
- **THEN** the runner runs `--mode local` with the current (post-loop) codebase and evaluates all assertions

#### Scenario: Behavioral gate flags findings if local mode has regressions
- **WHEN** local mode run has 2 assertion failures that were passing in baseline
- **THEN** the findings report summary includes `behavioral_gate: "failed"` and all confirmed findings are marked with `behavioral_validated: false`

#### Scenario: Behavioral gate is skipped if no local model is available
- **WHEN** `lms ps` shows no loaded model
- **THEN** the runner skips Phase 2 and writes `behavioral_gate: "skipped"` in the findings report summary

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
