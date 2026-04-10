## ADDED Requirements

### Requirement: Copilot skill orchestrates the refinement loop
The system SHALL provide a Copilot skill at `.github/skills/refine/SKILL.md` and a prompt at `.github/prompts/refine.prompt.md` that automate the implement → measure → evaluate → iterate cycle. The skill SHALL accept a change name (`--change`) and a mode (`--mode`, default `mock`).

#### Scenario: Skill invoked with change name
- **WHEN** the user runs `/refine --change file-tool-optimizations --mode mock`
- **THEN** the skill reads the change's `tasks.md`, starts the proxy, and begins the refinement loop

### Requirement: Skill runs baseline measurement before implementation
Before implementing any tasks, the skill SHALL run all applicable scenarios to establish a baseline report. This baseline is used as the comparison target for all subsequent iterations.

#### Scenario: Baseline collected before first task
- **WHEN** the skill starts with no prior reports
- **THEN** it runs `bun refinement/runner.ts --mode mock` and saves the result as the baseline

### Requirement: Skill implements task groups with checkpoints
The skill SHALL read the change's `tasks.md` and implement tasks in groups (as defined by the `## Group N` headers). After completing each group, the skill SHALL run scenarios, compare against baseline, and report the checkpoint results before proceeding.

#### Scenario: Group implemented and measured
- **WHEN** the skill completes Group 1 (3 tasks) of a change
- **THEN** it runs unit tests (`bun test`), runs scenarios, compares against baseline, and reports a diff table showing which metrics improved/regressed

#### Scenario: All groups completed
- **WHEN** all task groups have been implemented and measured
- **THEN** the skill reports overall results and suggests promoting to the next layer

### Requirement: Skill stops on regression
If any checkpoint shows a regression (a metric that was passing in baseline now fails, or a value worsened), the skill SHALL stop implementation, report the regression, and suggest reverting the current group or trying an alternative approach.

#### Scenario: Regression detected at checkpoint
- **WHEN** Group 2 causes `cache_prefix_stable` to flip from true to false
- **THEN** the skill stops, reports the regression with the specific metric and values, and waits for user direction

### Requirement: Skill supports layer promotion
After all task groups pass on the current layer, the skill SHALL suggest promoting to the next layer (mock → local → live). On user confirmation, it SHALL switch the proxy mode and re-run all scenarios.

#### Scenario: Promote from mock to local
- **WHEN** all scenarios pass in mock mode and user confirms promotion
- **THEN** the skill starts LM Studio (`lms server start`, `lms load qwen3.5:9b --gpu=max`), switches proxy to `--mode local`, and re-runs all scenarios

#### Scenario: Promote from local to live
- **WHEN** all scenarios pass in local mode and user confirms promotion
- **THEN** the skill switches proxy to `--mode live` and re-runs all scenarios, reporting real Anthropic usage stats

### Requirement: Skill manages LM Studio lifecycle for local mode
When operating in local mode, the skill SHALL ensure LM Studio's server is running and the appropriate model is loaded before running scenarios. On completion, it SHALL unload the model and optionally stop the server.

#### Scenario: LM Studio started for local mode
- **WHEN** the skill enters local mode
- **THEN** it runs `lms server start`, `lms load qwen3.5:9b --gpu=max --context-length=32768`, verifies with `lms ps`, and proceeds

#### Scenario: LM Studio cleaned up after local mode
- **WHEN** the skill finishes local mode execution
- **THEN** it runs `lms unload --all`
