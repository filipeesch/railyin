## Context

The refinement harness (`refinement/runner.ts`) currently uses a `ProxyMode` enum (`mock | local | live | auto`) to route requests. Each mode is hardcoded with assumptions: mock uses scripted responses, local forwards to `http://localhost:1234`, live forwards to `api.anthropic.com`. The auto loop sequences through mock → local → live in a fixed order.

Scenarios use toy fixture directories (`refinement/fixtures/basic-typescript`, `multi-module`) seeded into temp git repos. These fixtures don't exercise real tool resolution or complex multi-file exploration patterns. The engine-runner creates a fresh `git init` repo per scenario, copies fixture files, and runs against it.

The proxy (`refinement/proxy.ts`) branches on mode in `handleRequest()` — mock returns scripted SSE, local/live forward to a single `backendUrl`. There is no provider abstraction; the backend URL, model ID, and mode are flat arguments.

## Goals / Non-Goals

**Goals:**
- Replace `ProxyMode`-based routing with a provider-based system where each provider declares its type, endpoint, model, and configuration in `providers.yaml`
- Run the auto loop against any subset of declared providers, selected via `--providers` flag
- Use Railyin's own codebase (via git worktree at pinned commit) as the stable workload for non-mock scenarios
- Automate LM Studio model lifecycle (`lms load`/`lms unload`) for lmstudio-type providers
- Preserve mock provider for fast scripted testing without worktree overhead
- Support same-model variance measurement via `runs_per_scenario` (default 2)

**Non-Goals:**
- Outcome evaluation (judging plan quality) — only token/timing/cost metrics
- Concurrent provider execution — providers run sequentially to avoid GPU contention
- Auto-discovery of available models — user explicitly declares providers
- Supporting providers other than mock, lmstudio, and anthropic in this change
- Running `bun install` or building Railyin in the worktree — the codebase is used as-is for exploration

## Decisions

### D1: providers.yaml as the single configuration source

Provider configuration lives in `config/providers.yaml` (gitignored) with a committed `config/providers.yaml.sample`. The file declares `stable_commit`, `runs_per_scenario`, and an array of providers.

**Alternative considered**: Environment variables per provider — rejected because provider configs are multi-field (type, host, port, model, context_length, gpu) and env vars don't compose well for arrays.

**Alternative considered**: Extending existing `config/workspace.yaml` — rejected to keep refinement config decoupled from production workspace config.

### D2: Provider type discriminated union

Each provider has a `type` field (`mock | lmstudio | anthropic`) that determines lifecycle behavior:
- `mock`: No backend, no worktree. Uses scenario scripts.
- `lmstudio`: Requires `lms` CLI. Runner calls `lms load <model_key>` before runs, `lms unload --all` after. Supports `link_device` for network instances via `lms link`.
- `anthropic`: Direct API. Requires `api_key` (from provider config or `ANTHROPIC_API_KEY` env var).

The proxy receives the resolved `backendUrl` from the provider config rather than a CLI flag. The `ProxyMode` type is replaced with `ProviderType` in types.ts, though the proxy still needs to know if it should return mock responses or forward to a backend.

### D3: Git worktree per provider, reset between scenarios

For non-mock providers, the runner creates `git worktree add /tmp/railyin-bench-<provider-id>-<timestamp> <stable_commit>` before the provider's first scenario. Between scenarios within the same provider, it resets with `git checkout . && git clean -fd` (cheaper than recreating). After all scenarios for a provider complete, `git worktree remove --force` cleans up.

**Alternative considered**: One worktree per scenario — rejected because worktree creation is expensive and scenarios should be independent (reset is sufficient).

**Alternative considered**: Using the main checkout — rejected because scenarios modify files and we need isolation from the developer's working tree.

### D4: Scenario format extension for real-codebase scenarios

Real-codebase scenarios omit `fixtures` and `script` fields. They include:
- `prompt`: The task description for the model
- `codebase: railyin` (indicates worktree-based, not fixture-based)
- `column_tools`: Tool groups to enable
- `expected_behavior`: `max_rounds`, `must_complete`
- `assertions`: Only metric assertions (`cost_under`, `max_tokens_initial`), no cache assertions (which depend on deterministic mock ordering)

Mock scenarios stay unchanged with `script` and `fixtures` fields.

### D5: Runner orchestration flow

```
parse --providers, --scenarios flags
load providers.yaml
filter providers & scenarios

for each provider:
  if lmstudio: lms load <model_key>
  if not mock: create worktree
  
  for run in 1..runs_per_scenario:
    for each scenario:
      start proxy (provider.type, provider.backendUrl)
      run scenario through engine-runner (worktree path or temp git)
      collect metrics, write per-request captures
      stop proxy
      if not mock: git checkout . && git clean -fd
  
  if not mock: remove worktree
  if lmstudio: lms unload --all

write cross-provider comparison report
```

### D6: Per-provider pricing in cost simulation

The cost simulation currently uses hardcoded Sonnet pricing. With multiple providers, each provider config can optionally include `pricing: { input, cache_write, cache_read, output }` (per million tokens). If not specified, defaults to current Sonnet rates. This enables accurate cost comparison across models with different pricing.

## Risks / Trade-offs

- **[LMS CLI availability]** → Mitigation: Runner checks `which lms` before executing lmstudio provider runs; skips with warning if not found.
- **[Worktree disk space]** → Mitigation: Single worktree per provider (reused across scenarios), destroyed promptly. Railyin checkout is ~50MB.
- **[LM Studio model load time]** → Mitigation: Load once per provider, not per scenario. User accepts this latency.
- **[Network LM Studio reliability]** → Mitigation: `lms link` health check before first scenario; retry once on connection failure.
- **[Breaking existing mock tests]** → Mitigation: Mock provider follows exact same scenario shape. `--mode mock` CLI flag continues to work as shorthand for the default mock provider.
- **[Worktree path hardcoded to /tmp/]** → Acceptable on macOS; could be configurable later if needed.
