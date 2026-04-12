## MODIFIED Requirements

### Requirement: --mode auto entry point in runner
The runner SHALL accept `--mode auto` as a valid ProxyMode value. When invoked, it SHALL collect baselines from all available modes (mock, local, live) in sequence, then enter the cross-mode analysis and finding generation phase. The `--eval-mode` flag SHALL be removed; auto mode always collects all available modes.

#### Scenario: --mode auto collects all modes
- **WHEN** the user runs `bun refinement/runner.ts --mode auto` with LM Studio running and ANTHROPIC_API_KEY set
- **THEN** the runner collects mock baseline (1 run per scenario), local baseline (2 runs per scenario), and live baseline (2 runs per scenario)

#### Scenario: --mode auto with --skip-live
- **WHEN** the user runs `bun refinement/runner.ts --mode auto --skip-live`
- **THEN** the runner collects only mock and local baselines, skipping live mode

#### Scenario: --mode auto exits with non-zero if mock baseline fails
- **WHEN** the initial mock baseline run has any assertion failures
- **THEN** the runner exits with code 1 and prints "Mock baseline has failing assertions — fix before running --mode auto"

### Requirement: Behavioral gate runs over all modes
After the structural loop stabilizes, the runner SHALL re-run all available modes (not just local) to validate findings across models. If any mode shows assertion regressions, findings are flagged.

#### Scenario: Behavioral gate validates across modes
- **WHEN** the structural loop completes and both local and live backends are available
- **THEN** the runner re-runs mock, local, and live scenarios and checks for assertion regressions in each

### Requirement: Re-collection runs all modes after applying a finding
When a finding is applied and re-evaluated, the runner SHALL re-run all available modes (not just the original eval mode) to confirm the improvement is cross-model. A finding is confirmed only if the metric improves in mock AND does not regress assertions in local/live.

#### Scenario: Finding confirmed across modes
- **WHEN** a finding is applied and mock shows improvement AND local/live show no assertion regressions
- **THEN** the finding status transitions to "confirmed"

#### Scenario: Finding rolled back due to local regression
- **WHEN** a finding is applied and mock shows improvement BUT local mode has a behavioral assertion failure
- **THEN** the finding status transitions to "rolled_back"

## REMOVED Requirements

### Requirement: --eval-mode flag
**Reason**: Replaced by the multi-mode collection pipeline. Auto mode now always collects all available modes.
**Migration**: Remove `--eval-mode` flag usage. Use `--skip-live` to exclude live mode.
