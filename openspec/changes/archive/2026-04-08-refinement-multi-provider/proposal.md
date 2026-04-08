## Why

The refinement harness currently hardcodes three modes — mock, local, and live — with toy fixture scenarios. This prevents testing across multiple models, comparing token usage and cost metrics between providers on real codebases, and measuring same-model variance. A provider-based architecture lets users declare N providers (LM Studio local, LM Studio network via LM Link, Anthropic API, mock scripted) in a YAML file and run any combination of providers and scenarios per invocation, using Railyin's own codebase as the stable workload.

## What Changes

- **Provider registry**: New `providers.yaml` config file declaring available models with type, endpoint, model key, context length, and GPU/link settings. Replaces the hardcoded `--mode mock|local|live` flag with `--providers` and `--scenarios` selection flags.
- **Worktree lifecycle**: Each provider run gets an isolated git worktree in `/tmp/` at a pinned commit. Worktrees are created before the provider's runs, reset (`git checkout . && git clean -fd`) between scenarios, and removed after all scenarios complete.
- **LM Studio lifecycle**: Automated `lms load`/`lms unload` and `lms ps` health checks for lmstudio-type providers. Network LM Studio instances accessed via `lms link` with configurable `link_device`.
- **Real-codebase scenarios**: Four initial scenarios (`export-markdown`, `cost-tracking-ui`, `new-tool`, `retry-config`) that exercise explore+plan workflows on Railyin's actual source tree instead of toy fixtures.
- **Runner refactor**: The runner orchestrates per-provider execution with configurable `runs_per_scenario` (default 2) for same-model variance detection. Cross-provider comparison is informational.
- **Mock provider preserved**: Mock type still works for scripted cache/cost assertion testing, following the same scenario shape but without worktree setup.

## Capabilities

### New Capabilities
- `provider-registry`: Loading, validating, and selecting providers from `providers.yaml`. Includes provider type definitions (mock, lmstudio, anthropic), sample file generation, and `--providers` CLI flag filtering.
- `worktree-lifecycle`: Git worktree creation at a pinned commit, per-scenario reset, and teardown after provider runs complete. Worktree path resolution for engine-runner.
- `lmstudio-lifecycle`: Automated model loading/unloading via `lms` CLI, health checking via `lms ps`, and network access via `lms link` for remote LM Studio instances.
- `real-codebase-scenarios`: Scenario YAML files that target Railyin's own source tree with explore+plan prompts (`export-markdown`, `cost-tracking-ui`, `new-tool`, `retry-config`).

### Modified Capabilities
- `refinement-auto-loop`: The auto loop now iterates over providers instead of hardcoded modes. Baseline and re-runs use provider config instead of ProxyMode. The behavioral gate uses whichever provider is configured rather than requiring a dedicated local mode.
- `refinement-request-capture`: Request capture now tags each capture with the provider ID and model key rather than just the ProxyMode. Per-request JSON files are organized under `requests/<provider-id>/<scenario>/`.
- `refinement-cost-simulation`: Cost calculation uses per-provider pricing (from provider config) instead of hardcoded Sonnet pricing. Providers without explicit pricing fall back to Sonnet rates.

## Impact

- **Code**: `src/bun/ai/refinement/` — runner, proxy, engine-runner, types, analysis modules refactored from mode-based to provider-based execution.
- **Config**: New `config/providers.yaml.sample` (committed) and `config/providers.yaml` (gitignored). Existing scenario YAML files updated, four new scenario files added.
- **Skill**: `.github/skills/refine/SKILL.md` and `.github/prompts/refine.prompt.md` updated for provider-based invocation (`--providers`, `--scenarios` flags).
- **Dependencies**: No new runtime dependencies. Requires `lms` CLI for lmstudio-type providers (already expected in the environment).
