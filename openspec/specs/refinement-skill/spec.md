## Purpose
The refinement skill is a Copilot skill that automates the autonomous engine improvement loop: baseline → generate findings → apply/verify → behavioral gate. It operates on the current codebase independently, without requiring a change name or task list.

## Requirements

### Requirement: Copilot skill orchestrates the refinement loop
The system SHALL provide a Copilot skill at `.github/skills/refine/SKILL.md` and a prompt at `.github/prompts/refine.prompt.md` that automate the autonomous engine improvement loop. The skill SHALL accept `--providers` (comma-separated provider IDs), `--scenarios` (optional filter), and `--max-rounds N` (optional iteration cap). The skill SHALL NOT require a change name or task list — it operates on the current codebase independently.

#### Scenario: Skill invoked with providers
- **WHEN** the user runs `/refine --providers lmstudio-qwen35-9b --scenarios new-tool`
- **THEN** the skill runs Phase 1 (baseline), generates findings, loops through Phase 3 (apply/evaluate), and runs Phase 4 (behavioral gate)

#### Scenario: Skill respects max-rounds
- **WHEN** the user runs `/refine --providers lmstudio-qwen35-9b --max-rounds 3`
- **THEN** the skill stops the apply/evaluate loop after at most 3 finding iterations

### Requirement: Skill runs baseline measurement
Before generating findings, the skill SHALL run all applicable scenarios via `--phase baseline` to produce `baseline-report.json` and `capture-summary.json`. The report-dir path SHALL be saved and reused for all subsequent phase commands.

#### Scenario: Baseline produces capture summary
- **WHEN** the skill runs `bun refinement/runner.ts --mode auto --phase baseline --providers <ids>`
- **THEN** it writes `reports/<timestamp>-auto/capture-summary.json` with per-scenario capture paths

### Requirement: Skill generates findings from captures and docs
After the baseline, the skill SHALL read per-request capture JSON files from `capture-summary.json`, inspect token costs and tool schemas, fetch relevant Anthropic documentation, and emit a `findings.json` file (Finding[]) to the report-dir.

#### Scenario: Finding generated with doc reference
- **WHEN** the skill reads a capture file with high `inspection.cost.tools_tokens`
- **THEN** it fetches the relevant Anthropic tool-use doc, emits a finding with `doc_reference` and `metric_contract`, and writes it to `<report-dir>/findings.json`

#### Scenario: Finding without doc reference is skipped
- **WHEN** a potential inefficiency is detected but no relevant docs.anthropic.com URL is found
- **THEN** the skill does NOT emit a finding for that issue

### Requirement: Skill applies and evaluates findings in a loop
For each pending finding, the skill SHALL backup the target file, apply the code change, evaluate using `--phase evaluate`, and continue to the next finding. Exit code 2 means rolled back; exit code 0 means confirmed or ineffective.

#### Scenario: Finding confirmed
- **WHEN** `--phase evaluate` exits 0 and the metric improved
- **THEN** the finding status is set to `confirmed` and the skill proceeds to the next pending finding

#### Scenario: Finding rolled back
- **WHEN** `--phase evaluate` exits 2
- **THEN** the original file is restored, the finding status is set to `rolled_back`, and the skill proceeds to the next pending finding

### Requirement: Skill runs behavioral gate after loop
After all findings are processed, the skill SHALL run `--phase behavioral` to verify no assertion regressions were introduced by the confirmed changes.

#### Scenario: Behavioral gate passes
- **WHEN** `--phase behavioral` exits 0
- **THEN** the skill sets `behavioral_gate: "passed"` in `findings-report.json` and reports success

#### Scenario: Behavioral gate fails
- **WHEN** `--phase behavioral` exits non-zero
- **THEN** the skill reports which scenarios regressed and sets `behavioral_gate: "failed"`
