## Purpose
The refinement harness SHALL define a structured `Finding` type that represents a single optimization opportunity identified from per-request captures, track its status lifecycle, and aggregate all findings into a `FindingsReport` written alongside the run report.

## Requirements

### Requirement: Finding interface with source and evidence
Each finding SHALL be a typed object with fields: `id` (string, e.g. `"F001"`), `category`, `source` (file + line + symbol), `evidence` (current metric value, estimated metric value after change, doc_reference URL, doc_quote string), `metric_contract` (metric name + before + expected_after), `change` (type + description), and `status`.

#### Scenario: Finding has all required fields
- **WHEN** the AI generates a finding for a tool-schema verbosity issue
- **THEN** the finding object contains id, category, source.file, source.line, source.symbol, evidence.doc_reference, evidence.doc_quote, metric_contract.metric, metric_contract.before, metric_contract.expected_after, change.type, change.description, and status="pending"

#### Scenario: Finding id is sequential and unique within a loop run
- **WHEN** the auto loop generates multiple findings in one run
- **THEN** each finding has a unique id formatted as "F" followed by a zero-padded 3-digit number (F001, F002, ...)

### Requirement: Finding category enum
The `category` field SHALL be one of: `"token_waste"` (unnecessary tokens in tools/system/messages), `"cache_break"` (structure that prevents cache hits), `"schema_gap"` (missing or incorrect tool schema field), `"behavioral"` (functional correctness issue visible only in local mode).

#### Scenario: Category is one of the defined values
- **WHEN** a finding is generated from a large tools_tokens observation
- **THEN** its category is "token_waste"

#### Scenario: Category is "cache_break" for unstable hash causes
- **WHEN** a finding identifies that tool order changes between requests cause tools_hash to vary
- **THEN** its category is "cache_break"

### Requirement: Finding status lifecycle
A finding's status SHALL progress according to the following lifecycle:
- `pending`: Generated, not yet applied
- `applied`: Change has been written to disk, re-run not yet complete
- `confirmed`: Re-run improved the target metric as specified in metric_contract
- `rolled_back`: Re-run showed the target metric did not improve, OR an assertion regressed; changes were reverted
- `ineffective`: Re-run showed no regression AND no improvement — change was neutral

#### Scenario: Finding status transitions to confirmed
- **WHEN** a finding with metric_contract `{metric: "total_cost", before: 0.010, expected_after: 0.008}` is applied AND the re-run produces total_cost ≤ 0.008
- **THEN** the finding status transitions to "confirmed"

#### Scenario: Finding status transitions to rolled_back on metric failure
- **WHEN** a finding is applied AND the re-run produces a total_cost equal to or worse than before
- **THEN** the finding status transitions to "rolled_back" and the changed files are restored

#### Scenario: Finding status transitions to rolled_back on assertion regression
- **WHEN** a finding is applied AND any assertion that was previously passing is now failing
- **THEN** the finding status transitions to "rolled_back" regardless of metric improvement

#### Scenario: Finding status transitions to ineffective
- **WHEN** a finding is applied AND the target metric did not worsen AND no assertions regressed AND the metric did not improve
- **THEN** the finding status transitions to "ineffective"

### Requirement: Metric contract specifies the target metric and threshold
The `metric_contract` field SHALL specify which metric the finding targets (`total_cost`, `tools_tokens`, `cache_hit_ratio`, or `cache_savings_pct`) and the numeric `before` value and `expected_after` threshold. Confirmation requires the post-change metric to be better than (or equal to) `expected_after`.

#### Scenario: Metric contract for a token_waste finding
- **WHEN** a finding targets tools_tokens reduction
- **THEN** metric_contract.metric = "tools_tokens", before = current average tools_tokens, expected_after < before

#### Scenario: Metric contract for cache_hit_ratio improvement
- **WHEN** a finding targets cache stability
- **THEN** metric_contract.metric = "cache_hit_ratio", before = current ratio (0.0–1.0), expected_after > before

### Requirement: Evidence includes a doc reference and quote
Each finding's `evidence` field SHALL include a `doc_reference` (URL of the Anthropic documentation page used) and a `doc_quote` (verbatim excerpt from that page justifying the proposed change). Findings without a valid doc reference SHALL NOT be applied.

#### Scenario: Evidence links to a specific Anthropic docs URL
- **WHEN** a finding is generated for tool description verbosity
- **THEN** evidence.doc_reference is a docs.anthropic.com URL (e.g. "https://docs.anthropic.com/en/docs/build-with-claude/tool-use/implement-tool-use")

#### Scenario: Finding without doc reference is not applied
- **WHEN** the AI generates a finding with evidence.doc_reference = "" or null
- **THEN** the runner skips the finding and marks it "ineffective" with a note that doc reference is missing

### Requirement: FindingsReport format
The findings report SHALL be a JSON file written to `reports/<timestamp>-auto/findings-report.json` with fields: `run_id`, `timestamp`, `mode`, `rounds` (array of per-round summaries), `findings` (flat array of all Finding objects with final status), `summary` (total confirmed, rolled_back, ineffective, total_cost_before, total_cost_after, improvement_pct).

#### Scenario: Findings report written at end of auto loop
- **WHEN** the auto loop completes (confirmed, rolled_back, or plateau)
- **THEN** a findings-report.json is written in the run's report directory

#### Scenario: Findings report includes round summaries
- **WHEN** the loop ran 3 rounds
- **THEN** the `rounds` array contains 3 entries, each with: round number, findings attempted, findings confirmed, total_cost at end of round

#### Scenario: Findings report summary shows net improvement
- **WHEN** 4 findings were confirmed and 2 were rolled back across 3 rounds
- **THEN** summary.confirmed = 4, summary.rolled_back = 2, summary.improvement_pct shows the % reduction in total_cost from total_cost_before to total_cost_after
