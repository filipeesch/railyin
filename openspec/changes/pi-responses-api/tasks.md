## 1. Dependency Upgrade

- [ ] 1.1 Bump `@earendil-works/pi-coding-agent` from `^0.80.3` to `^0.84.1` in `package.json`
- [ ] 1.2 Add `@earendil-works/pi-ai: ^0.84.1` as a direct dependency in `package.json` (imported directly by `model-builder.ts`, `execution-controller.ts`, `tools/*`, tests)
- [ ] 1.3 Run `bun install` and update `bun.lock`
- [ ] 1.4 Run `bun run typecheck` and the Pi test suite to surface any SDK surface drift (TypeBox 1.3.7, event shapes); fix compile errors — note: the five faux-provider integration files will fail to compile until step 7 (AuthStorage removed)

## 2. Config Types + Validation

- [ ] 2.1 Add `api?: PiApiMode` to `PiEngineConfig` (engine root) in `src/bun/config/index.ts`
- [ ] 2.2 Add `api?: PiApiMode` to `PiProviderConfig` (per-provider override)
- [ ] 2.3 Extend `validatePiEngineConfig` in `pi-config-validation.ts` to reject `api` values outside the union at both levels, with a descriptive error
- [ ] 2.4 Update `config/engines.yaml.sample` with documented `api:` examples (engine default + provider override) and the `openai-responses` default note

## 3. PiApiMode Resolver (new module)

- [ ] 3.1 Create `src/bun/engine/pi/api-mode.ts` exporting `type PiApiMode`, `DEFAULT_API_MODE = "openai-responses"`, and `resolvePiApiMode(config, providerName)` implementing `providers.<name>.api ?? config.api ?? DEFAULT_API_MODE`

## 4. ModelRuntime Migration + Shared Session Factory (required by SDK ≥0.80.8)

- [ ] 4.1 Create `src/bun/engine/pi/model-runtime-builder.ts` with `buildPiModelRuntime(config): Promise<ModelRuntime>`:
  - `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false, modelsPath: null })`
  - `registerProvider(name, { baseUrl, apiKey: cfg.api_key ?? "no-key", api: resolvePiApiMode(config, name) })` for every `config.providers` entry
  - ensure the `"default"` fallback provider is registered (baseUrl `http://localhost:1234/v1`, resolved api) for models without a provider prefix
- [ ] 4.2 Create `src/bun/engine/pi/pi-session-factory.ts` with shared `createPiAgentSession(options)` parameterized over: session manager (disk-backed for parent vs `SessionManager.inMemory` for child), system prompt (override only when non-empty vs always-override with SUBAGENT suffix), thinking level (child inherits parent's resolved level); builds the runtime via `buildPiModelRuntime(config)` and calls `createAgentSession`
- [ ] 4.3 Rewire `defaultSessionFactory` in `engine.ts` as a thin wrapper over `createPiAgentSession`; remove the `AuthStorage` import
- [ ] 4.4 Rewire `defaultChildSessionFactory` in `child-session.ts` the same way; remove the `AuthStorage` import

## 5. API-Mode Wiring in Model Building

- [ ] 5.1 In `model-builder.ts`, set `api: resolvePiApiMode(config, providerName)` and change the return type to `Model<PiApiMode>`
- [ ] 5.2 Compat filtering: always set `supportsDeveloperRole: false`; only add `thinkingFormat` / `requiresReasoningContentOnAssistantMessages` when the resolved mode is `openai-completions` (silently dropped under `openai-responses`)
- [ ] 5.3 Replace hardcoded `Model<"openai-completions">` type refs with `Model<PiApiMode>` in: `engine.ts` (`SessionFactoryOptions`), `session-manager.ts`, `execution-controller.ts`, `child-session.ts`, `tools/delegate.ts`

## 6. Docs

- [ ] 6.1 Update `config/engines.yaml` (working sample) with the `api` keys and default-mode note
- [ ] 6.2 Update AGENTS.md Pi section: new `api` option, `openai-responses` default, `ModelRuntime` + shared factory note

## 7. New Test Suites + Migration of Faux-Provider Integration Tests

- [ ] 7.1 Create `src/bun/test/support/pi-faux-session.ts` shared test helper: `registerFauxProvider()` + session creation via the production `createPiAgentSession` (completions mode)
- [ ] 7.2 New `src/bun/test/pi/api-mode.test.ts`: `resolvePiApiMode` scenarios — engine default applies to all providers; provider override wins; absent `api` → `openai-responses`; unknown provider name → engine default; unconfigured provider prefix → engine default; `"default"` provider → engine default
- [ ] 7.3 Update `src/bun/test/pi/model-builder.test.ts`: rewrite MB-1 for the new default (`api === "openai-responses"`); add engine-level `api` → `Model.api`; provider override → `Model.api`; `supportsDeveloperRole: false` in both modes; `thinkingFormat`/`requiresReasoningContentOnAssistantMessages` kept under completions and dropped under responses (deepseek + openrouter/deepseek cases)
- [ ] 7.4 Update `src/bun/test/pi/config-validation.test.ts`: invalid `api` rejected at engine level; invalid `api` rejected at provider level; valid values pass at both levels
- [ ] 7.5 New `src/bun/test/pi/model-runtime-builder.test.ts` (hermetic): configured providers registered with baseUrl/apiKey/resolved api; `"default"` fallback registered for unprefixed models; provider override reflected in registration; `getAuth(providerId)` resolves the runtime api key; no catalog network refresh (creation succeeds without network)
- [ ] 7.6 New `src/bun/test/pi/session-factory.test.ts` (real SDK + faux, completions round-trip): parent mode — session created, `systemPromptOverride` only when non-empty; child mode — SUBAGENT suffix appended, in-memory SessionManager, inherited thinking level; forwarded `model` carries the resolved api; provider runtime registered for the model's provider
- [ ] 7.7 New `src/bun/test/pi/api-mode-e2e.test.ts` (capture-level, no-output-regression pattern): PiEngine `execute()` with injected capture-factory asserts `options.model.api` — `openai-responses` for engine-level config; `openai-completions` for provider override; `openai-responses` when absent; stream still emits tokens + done
- [ ] 7.8 Migrate the five faux-provider integration files to the shared helper (compile-mandatory: AuthStorage removed in 0.84.1), preserving their scenarios: `pi/no-output-regression.test.ts`, `pi-session-tools-integration.test.ts`, `pi-mcp-discovery-faux-provider.test.ts`, `pi-decision-streaming.test.ts`, `integration/instruction-loading.test.ts`

## 8. Verification

- [ ] 8.1 `bun run typecheck`
- [ ] 8.2 Run the Pi unit + integration suites (`bun test src/bun/test/pi --timeout 20000`) plus `pi-engine.test.ts` (vitest, in-memory DB), `pi-session-tools-integration.test.ts`, `pi-decision-streaming.test.ts`; fix failures
- [ ] 8.3 Run API smoke tests (`bun test e2e/api --timeout 30000`)
- [ ] 8.4 Run the Playwright UI suite (`bun run test:e2e`) — expected green without new specs (feature has zero UI surface)
- [ ] 8.5 Manual smoke against a local server: engine with `api: openai-completions` and engine with `api: openai-responses` (or provider override), verify request paths
- [ ] 8.6 Commit implementation and push branch
