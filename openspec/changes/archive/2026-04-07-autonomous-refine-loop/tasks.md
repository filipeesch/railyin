## 1. Types

- [x] 1.1 Add `"auto"` to `ProxyMode` union in `refinement/types.ts`
- [x] 1.2 Add `Finding` interface to `refinement/types.ts` (id, category, source, evidence, metric_contract, change, status)
- [x] 1.3 Add `FindingCategory` and `FindingStatus` type aliases to `refinement/types.ts`
- [x] 1.4 Add `FindingsReport` interface to `refinement/types.ts` (run_id, timestamp, mode, rounds, findings, summary)
- [x] 1.5 Add `CaptureSummary` interface to `refinement/types.ts` (per-scenario token averages, cache_hit_ratio, total_cost, capture paths)

## 2. Capture Summary Writer

- [x] 2.1 Add `writeCaptureSummary(reportDir, baseline)` function in `refinement/runner.ts` that aggregates per-scenario token averages and cache metrics from the baseline `RunReport`
- [x] 2.2 Include per-scenario capture file paths in the summary (pointing to `requests/<scenario>/NNN.json`)
- [x] 2.3 Write the summary to `reports/<timestamp>-auto/capture-summary.json`

## 3. File Backup / Restore

- [x] 3.1 Add `backupFiles(reportDir, findingId, filePaths)` in `refinement/runner.ts` — reads each file and writes to `reports/<timestamp>-auto/backups/<findingId>/<basename>`
- [x] 3.2 Add `restoreFiles(reportDir, findingId)` in `refinement/runner.ts` — reads from backup dir and writes back to original paths
- [x] 3.3 Track the `source.file` path in the finding so `backupFiles` knows which files to back up

## 4. Findings Report Writer

- [x] 4.1 Add `writeFindingsReport(reportDir, report)` in `refinement/runner.ts` — serialises `FindingsReport` to `findings-report.json` and overwrites on each call
- [x] 4.2 Call `writeFindingsReport` immediately after each finding's status is resolved (not only at loop end)
- [x] 4.3 Include a `rounds` entry at the end of each loop iteration with: round number, findings attempted, findings confirmed, total_cost at end of round

## 5. Auto Loop Orchestration

- [x] 5.1 Add `runAutoLoop(scenarios, options)` function in `refinement/runner.ts` as the entry point for `--mode auto`
- [x] 5.2 In `runAutoLoop`: run baseline mock pass; exit with code 1 if any assertions fail
- [x] 5.3 Write `capture-summary.json` after baseline (calls §2 function)
- [x] 5.4 Accept findings array as JSON input (from stdin or a temp file the skill writes); parse and validate against `Finding[]`
- [x] 5.5 Iterate findings one at a time: backup → apply → re-run mock → evaluate metric contract + assertions → confirm or rollback → update status → write report
- [x] 5.6 Implement plateau detection: track per-round `total_cost` improvement; stop if last 3 rounds each show < 1% improvement
- [x] 5.7 Implement `--max-rounds N` CLI flag; stop loop after N rounds regardless of remaining findings
- [x] 5.8 After loop stabilises, check if local model is available (`lms ps`); if yes, run behavioral gate

## 6. Behavioral Gate

- [x] 6.1 Add `runBehavioralGate(scenarios, options)` in `refinement/runner.ts` — runs all scenarios in local mode using the current post-loop codebase
- [x] 6.2 Compare behavioral gate assertion results against baseline; mark any regressions
- [x] 6.3 If regressions found: set `behavioral_gate: "failed"` in findings report summary, mark all confirmed findings with `behavioral_validated: false`
- [x] 6.4 If no regressions: set `behavioral_gate: "passed"` and `behavioral_validated: true` on confirmed findings
- [x] 6.5 If no local model available: set `behavioral_gate: "skipped"` in summary and skip the local run

## 7. Runner CLI Integration

- [x] 7.1 Add `"auto"` to the mode argument parser in `refinement/runner.ts` (alongside existing `mock | local | live`)
- [x] 7.2 Route `--mode auto` to `runAutoLoop()` instead of the standard single-pass flow
- [x] 7.3 Use `reports/<timestamp>-auto/` as the output directory when mode is `"auto"` (distinct from `reports/<timestamp>/`)

## 8. Skill and Prompt Update

- [x] 8.1 Rewrite the Finding generation instructions in `.github/skills/refine/SKILL.md` — describe how to read `capture-summary.json`, analyze captures, perform per-finding doc search, and emit `Finding[]` JSON
- [x] 8.2 Document the autonomous loop phases (structural mock loop, behavioral gate) in `SKILL.md`
- [x] 8.3 Document `--mode auto` usage, stopping conditions, and findings report location in `SKILL.md`
- [x] 8.4 Add `--mode auto` command entry to `.github/prompts/refine.prompt.md`
- [x] 8.5 Add `--max-rounds` flag documentation to both `SKILL.md` and `refine.prompt.md`

## 9. Tests

- [x] 9.1 Add unit test for `Finding` status lifecycle transitions in `refinement/test/`
- [x] 9.2 Add unit test for `backupFiles` / `restoreFiles` — write a temp file, backup, mutate, restore, verify content matches
- [x] 9.3 Add unit test for `writeCaptureSummary` — mock a `RunReport`, verify output JSON shape
- [x] 9.4 Add unit test for `writeFindingsReport` — verify incremental write after each finding
- [x] 9.5 Add unit test for plateau detection — simulate 3 rounds with < 1% improvement, verify loop exits
- [x] 9.6 Add unit test for metric contract evaluation — finding with `expected_after: 0.008`, post-run cost `0.007` → confirmed; `0.011` → rolled_back
- [x] 9.7 Add unit test for assertion regression rollback — finding that improves cost but causes a pass→fail assertion transition → rolled_back
