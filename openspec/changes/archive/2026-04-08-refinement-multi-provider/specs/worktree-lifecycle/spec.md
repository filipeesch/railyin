## ADDED Requirements

### Requirement: Worktree creation at pinned commit
For each non-mock provider, the runner SHALL create a git worktree at `/tmp/railyin-bench-<provider-id>-<timestamp>` checked out to the `stable_commit` from providers.yaml before the provider's first scenario run.

#### Scenario: Worktree created for lmstudio provider
- **WHEN** the runner begins execution for an lmstudio provider with `stable_commit: c679d29`
- **THEN** the runner executes `git worktree add /tmp/railyin-bench-<id>-<ts> c679d29` and the worktree directory contains the Railyin source tree at that commit

#### Scenario: Worktree not created for mock provider
- **WHEN** the runner begins execution for a mock provider
- **THEN** no worktree is created; the engine-runner uses its existing temp git repo with fixture files

#### Scenario: Worktree creation fails exits with error
- **WHEN** `git worktree add` fails (e.g., commit not found, disk full)
- **THEN** the runner prints the git error, skips the provider, and continues to the next provider

### Requirement: Per-scenario reset within worktree
Between scenario runs within the same provider, the runner SHALL reset the worktree to its original state using `git checkout . && git clean -fd` instead of recreating the worktree.

#### Scenario: Worktree reset between scenarios
- **WHEN** the `export-markdown` scenario completes and `new-tool` is next for the same provider
- **THEN** the runner executes `git checkout . && git clean -fd` in the worktree directory before starting `new-tool`

#### Scenario: Reset removes files created by the model
- **WHEN** a scenario run creates new files in the worktree (e.g., `src/new-feature.ts`)
- **THEN** `git clean -fd` removes those files, restoring the worktree to the pinned commit state

### Requirement: Worktree teardown after provider completion
After all scenarios for a provider complete (including all `runs_per_scenario` iterations), the runner SHALL remove the worktree with `git worktree remove --force <path>`.

#### Scenario: Worktree removed after provider finishes
- **WHEN** all scenarios and runs for provider `lmstudio-qwen` complete
- **THEN** the runner executes `git worktree remove --force /tmp/railyin-bench-lmstudio-qwen-<ts>` and the directory no longer exists

#### Scenario: Worktree removed even if scenarios fail
- **WHEN** a scenario run fails with an error for provider `anthropic-sonnet`
- **THEN** the worktree is still removed in the cleanup phase

### Requirement: Worktree path passed to engine-runner
The engine-runner SHALL accept an optional `worktreePath` parameter. When provided, it uses this path as the working directory instead of creating a temp git repo with fixtures.

#### Scenario: Engine-runner uses worktree path
- **WHEN** `runScenarioThroughEngine` is called with `worktreePath: "/tmp/railyin-bench-lmstudio-qwen-1234"`
- **THEN** the engine-runner uses that path as `gitDir` instead of calling `mkdtempSync` and `git init`

#### Scenario: Engine-runner falls back to temp git for mock
- **WHEN** `runScenarioThroughEngine` is called without `worktreePath` and the scenario has `fixtures: basic-typescript`
- **THEN** the engine-runner creates a temp git repo and copies fixtures as it does today
