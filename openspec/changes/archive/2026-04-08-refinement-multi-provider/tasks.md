## 1. Types & Provider Config

- [x] 1.1 Add ProviderType, ProviderConfig, and ProvidersYaml types to refinement/types.ts (replace ProxyMode with ProviderType for non-auto uses)
- [x] 1.2 Create config/providers.yaml.sample with example mock, lmstudio, and anthropic providers
- [x] 1.3 Add config/providers.yaml to .gitignore
- [x] 1.4 Implement loadProviders() in a new refinement/providers.ts — parse YAML, validate required fields per type, resolve backendUrl

## 2. Worktree Lifecycle

- [x] 2.1 Implement createWorktree(providerId, stableCommit) → returns worktree path in /tmp/
- [x] 2.2 Implement resetWorktree(worktreePath) — git checkout . && git clean -fd
- [x] 2.3 Implement removeWorktree(worktreePath) — git worktree remove --force
- [x] 2.4 Update engine-runner.ts to accept optional worktreePath param, skip temp git repo creation when provided

## 3. LM Studio Lifecycle

- [x] 3.1 Implement checkLmsCli() — verify `which lms` succeeds
- [x] 3.2 Implement loadModel(modelKey, gpu) — lms load with gpu flag, wait for completion
- [x] 3.3 Implement unloadModels() — lms unload --all
- [x] 3.4 Implement healthCheck(modelKey) — lms ps --json, verify model in list, retry once after 3s
- [x] 3.5 Handle link_device: skip local lms load/unload for network providers

## 4. Real-Codebase Scenarios

- [x] 4.1 Add `codebase` field support to scenario loading in refinement/scenarios.ts with validation (reject codebase + fixtures conflict)
- [x] 4.2 Create refinement/scenarios/export-markdown.yaml
- [x] 4.3 Create refinement/scenarios/cost-tracking-ui.yaml
- [x] 4.4 Create refinement/scenarios/new-tool.yaml
- [x] 4.5 Create refinement/scenarios/retry-config.yaml

## 5. Proxy Provider Routing

- [x] 5.1 Refactor proxy.ts handleRequest to accept provider config (type + backendUrl) instead of ProxyMode + backendUrl separately
- [x] 5.2 Update mock response path to check provider.type === "mock" instead of mode === "mock"
- [x] 5.3 Pass provider pricing to cost calculation, fall back to Sonnet defaults when absent

## 6. Runner Refactor

- [x] 6.1 Add --providers and --scenarios CLI flags to runner.ts argument parsing
- [x] 6.2 Implement provider selection logic (--providers flag → filter, fallback to default_providers)
- [x] 6.3 Implement scenario selection logic (--scenarios flag → filter, fallback to all)
- [x] 6.4 Implement per-provider orchestration loop: load model → create worktree → run scenarios × runs_per_scenario → reset between scenarios → teardown
- [x] 6.5 Maintain backward compat for --mode mock (select first mock provider) and --mode auto (provider-based loop)
- [x] 6.6 Update report directory structure to organize captures under requests/<provider-id>/<scenario>/

## 7. Cost & Analysis Updates

- [x] 7.1 Update cost simulation to accept per-provider pricing from provider config
- [x] 7.2 Add cross-provider comparison table to report output
- [x] 7.3 Add same-model variance metrics (mean, stddev) for runs_per_scenario > 1
- [x] 7.4 Update capture-summary.json to include per-provider metric sections

## 8. Auto Loop Integration

- [x] 8.1 Refactor runAutoLoop to load providers and iterate over selected providers instead of hardcoded modes
- [x] 8.2 Update baseline phase to collect per-provider metrics
- [x] 8.3 Update behavioral gate to use configurable behavioral_provider from providers.yaml
- [x] 8.4 Update findings report to include provider metadata per finding

## 9. Skill & Prompt Updates

- [x] 9.1 Update .github/skills/refine/SKILL.md with provider-based invocation (--providers, --scenarios flags)
- [x] 9.2 Update .github/prompts/refine.prompt.md with new CLI flags and provider workflow

## 10. Validation & Cleanup

- [ ] 10.1 Run existing refinement tests with mock provider to verify backward compat
- [ ] 10.2 Test full provider orchestration loop with mock provider (worktree skip, scripted responses)
- [x] 10.3 Remove deprecated --eval-mode references and hardcoded mode routing from runner.ts
