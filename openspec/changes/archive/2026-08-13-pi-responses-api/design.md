## Context

The Pi engine in Railyin (`src/bun/engine/pi/`) uses `@earendil-works/pi-coding-agent@0.80.3`. Exploration of the published 0.84.x packages verified:

- pi-ai's `Model.api` accepts `"openai-completions"` (current hardcode) and `"openai-responses"`; the responses provider calls `client.responses.create()` → `${baseUrl}/responses`, while completions calls `client.chat.completions.create()` → `${baseUrl}/chat/completions`. Railyin's existing `base_url` values (e.g. `http://localhost:1234/v1`) work unchanged for both.
- SDK 0.80.8+ removed `AuthStorage` and `CreateAgentSessionOptions.authStorage`/`modelRegistry`, replacing them with the async `modelRuntime: ModelRuntime` option. `ModelRuntime.create({ credentials, refreshOnCreate })` plus `registerProvider(providerId, { baseUrl, apiKey, api })` is the migration path; `InMemoryCredentialStore` comes from pi-ai.
- The rest of the SDK surface Railyin uses is stable in 0.84.1: `createAgentSession({ model: Model<any>, ... })`, `AgentSession` (`prompt`, `waitForIdle`, `subscribe`, `abort`, `dispose`, `compact`, `setActiveToolsByName`, `getContextUsage`), `Agent` (`state`, `onPayload`, `beforeToolCall`, `continue`, `waitForIdle`), `SettingsManager.inMemory`, `SessionManager.open`, `DefaultResourceLoader`, `defineTool`, pi-agent-core `AgentTool`, pi-ai `isContextOverflow`/`Type`, and the faux-provider test helpers.
- `registerFauxProvider({ api })` supports custom api modes, but the test strategy intentionally keeps real-SDK round-trips in completions mode only (see Decision 11).
- Five faux-provider integration test files hand-roll session factories that duplicate production `defaultSessionFactory` and all use the removed `AuthStorage`; the production parent/child session factories have no direct test coverage today.
- `main` was merged into the branch before this change; the merged dialect/instruction and streaming-decision-request work is orthogonal to the model/session/auth path.

The codebase already follows config-driven behavior (`engines.yaml` → `PiEngineConfig`), per-model config (`models.<id>`), per-provider config (`providers.<name>`), and dependency-injected services. This change follows those patterns.

## Goals / Non-Goals

**Goals:**
- Upgrade to `@earendil-works/pi-coding-agent@^0.84.1` (and pin `pi-ai` as a direct dep).
- Add `api: openai-completions | openai-responses` config at engine root with per-provider override.
- Default the mode to `openai-responses` when unset (per decision).
- Migrate `AuthStorage` → `ModelRuntime` in both session factories (required by the upgrade).
- Consolidate parent/child session creation into one shared production factory (removes duplication, makes the real factory testable).
- Keep the shared `Model<PiApiMode>` type generalization minimal and mechanical.
- Silently ignore completions-only compat keys (`thinkingFormat`, `requiresReasoningContentOnAssistantMessages`) under `openai-responses`; keep `supportsDeveloperRole: false` for both modes.
- Preserve all other observable behavior: event translation, compaction, delegate tool, provider limiter, listModels.

**Non-Goals:**
- No changes to shared RPC types, frontend stores, or workflow YAML.
- No UI for the new option (engines.yaml is edited via the raw YAML editor; no schema).
- No per-model `api` config (model-level granularity is not needed; provider is the natural level).
- No real-SDK round-trips in `openai-responses` mode (the faux provider supports it, but the plug-in mechanics need a spike after the SDK bump; deferred).
- No moving the provider limiter into an SDK transport hook (the call-site limiter stays; noted as follow-up).
- No removal of the deprecated `PiEngine` test shims (deferred cleanup).
- No new Playwright tests (zero UI surface; all UI tests mock `/api/*`).

## Decisions

### 1. API mode config: engine default + provider override
**Decision:** Add `api` to `PiEngineConfig` (engine root) and `PiProviderConfig` (per provider). Effective mode = `providers.<name>.api ?? config.api ?? DEFAULT_API_MODE`.
**Rationale:** The mode is a property of the endpoint (a server exposes /v1/chat/completions and/or /v1/responses). One line switches the common case; mixed setups override per endpoint. This also maps cleanly to the SDK: `ProviderConfigInput.api` is per-provider and `Model.api` per-model.
**Alternative considered:** engine-only, per-model-only, model-override-on-engine-default. Rejected: engine-only can't express mixed endpoints; per-model repeats the same server property N times and invites inconsistent configs.

### 2. Version bump: `^0.84.1` caret + direct pi-ai dep
**Decision:** `"@earendil-works/pi-coding-agent": "^0.84.1"` and add `"@earendil-works/pi-ai": "^0.84.1"` to dependencies.
**Rationale:** Matches the project's caret convention for SDKs. pi-ai is imported directly (`Model`, `isContextOverflow`, `Type`) but is only transitive today; making it direct keeps the version explicit.
**Note:** The SDK has made breaking changes in minor releases (0.80.8 removed AuthStorage); caret caps at <0.85.0.

### 3. Default mode is `openai-responses`
**Decision:** `DEFAULT_API_MODE = "openai-responses"`. Existing configs without `api:` switch endpoints after this change.
**Rationale:** User decision — OpenAI ecosystem momentum toward Responses; LM Studio/vLLM are adding `/v1/responses`. Configs can opt back to `api: openai-completions`.
**Risk mitigation:** Documented as BREAKING in proposal + sample file; validation rejects unknown values with a clear message.

### 4. New `PiApiMode` resolver module (SRP)
**Decision:** New `src/bun/engine/pi/api-mode.ts` exporting `type PiApiMode = "openai-completions" | "openai-responses"`, `DEFAULT_API_MODE`, and `resolvePiApiMode(config, providerName)`.
**Rationale:** Single source of truth consumed by `PiModelBuilder` (Model.api) and `buildPiModelRuntime` (ProviderConfigInput.api), avoiding drift. Keeps `PiModelBuilder` and the runtime builder free of config-shape knowledge beyond the one call.
**Alternative considered:** inline resolution in each consumer. Rejected: two consumers would duplicate precedence logic.

### 5. Shared `buildPiModelRuntime()` builder
**Decision:** New `src/bun/engine/pi/model-runtime-builder.ts` exporting `buildPiModelRuntime(config): Promise<ModelRuntime>`:
- `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false })` (no network catalog refresh — Railyin registers its own providers)
- For each `config.providers` entry: `registerProvider(name, { baseUrl, apiKey: cfg.api_key ?? "no-key", api: resolvePiApiMode(config, name) })`
- Ensure the `"default"` fallback provider exists (baseUrl `http://localhost:1234/v1`, api resolved mode), mirroring today's `authStorage.setRuntimeApiKey(model.provider, ...)` behavior for unconfigured providers

**Rationale:** Both session factories duplicate the auth/provider setup today; the builder removes the duplication and makes the migration a single point of change.
**Alternative considered:** keep per-factory inline runtimes. Rejected: duplication of auth + provider registration in two places.

### 6. Model builder emits resolved api + filters completions-only compat
**Decision:** `PiModelBuilder.build()` uses `api: resolvePiApiMode(config, providerName)`. Compat construction:
- `supportsDeveloperRole: false` is always set (both modes) — local servers don't accept the `developer` role.
- `thinkingFormat` / `requiresReasoningContentOnAssistantMessages` are only added when the resolved mode is `openai-completions`; under `openai-responses` they are silently dropped (no validation error).
**Rationale:** `OpenAIResponsesCompat` has a different shape; unknown keys are ignored by the SDK anyway, so dropping them is type-legal and behavior-preserving. User decision: silent ignore over validation rejection.

### 7. Generalize `Model<"openai-completions">` → `Model<PiApiMode>`
**Decision:** Replace the hardcoded generic in `engine.ts` (`SessionFactoryOptions`), `session-manager.ts`, `execution-controller.ts`, `child-session.ts`, and `tools/delegate.ts` with `Model<PiApiMode>`.
**Rationale:** Mechanical type widening; `createAgentSession` accepts `Model<any>`. Keeps type safety at the model construction site.
**Alternative considered:** `Model<any>` everywhere. Rejected: loses the api-mode discrimination.

### 8. Config validation for `api` values
**Decision:** `validatePiEngineConfig` rejects `api` values outside the `PiApiMode` union with a descriptive error, at both engine and provider level.
**Rationale:** Fail-fast on typos, consistent with the existing `interleaved` → `thinkingFormat` rejection pattern.

### 9. Shared `createPiAgentSession` factory (production refactor enabling testing)
**Decision:** Extract the ~90%-identical parent/child session creation into one production function `createPiAgentSession(options)` in `src/bun/engine/pi/pi-session-factory.ts`. Parameterized over:
- session manager: disk-backed (`SessionManager.open(path)`) for parent sessions vs in-memory (`SessionManager.inMemory(cwd)`) for child sessions
- system prompt: `systemPromptOverride` only when non-empty (parent) vs always-override with the subagent suffix appended (child)
- thinking level: applied to `session.agent.state.thinkingLevel` (child inherits parent's resolved level; parent leaves SDK default)

Both `defaultSessionFactory` and `defaultChildSessionFactory` become thin wrappers over it. The shared function builds the `ModelRuntime` via `buildPiModelRuntime(config)` and passes it to `createAgentSession`.
**Rationale:** Removes production duplication (two ~90%-identical factories); gives the real production session path direct test coverage for the first time (the five faux-provider integration files currently test test-only copies of the factory); the `SessionFactory` injection point into `PiEngine` is unchanged.
**Alternative considered:** keep two factories and only migrate auth inline. Rejected: duplicates the ModelRuntime migration across production + 5 test files and keeps the drift between tests and production.

### 10. `buildPiModelRuntime` tested hermetically against the real SDK
**Decision:** Test `buildPiModelRuntime` against the real `ModelRuntime` with `refreshOnCreate: false`, an explicit `InMemoryCredentialStore`, and no models path — no network, no mocks of the SDK. Assertions use the runtime's own read surface (`getRegisteredProviderConfig`, `getAuth`, `getRegisteredProviderIds`).
**Rationale:** The SDK runtime is already hermetic under this configuration; mocking it would test nothing. Prefer real integration over mocks when the real thing is deterministic (project DI convention applies to mocks of Railyin's own services, not to re-implementing SDK behavior).

### 11. Test strategy: unit + capture-level E2E; completions-only round-trips
**Decision:** Cover the api-mode decision surface with (a) unit tests for `resolvePiApiMode`, `PiModelBuilder`, `validatePiEngineConfig`, `buildPiModelRuntime`; (b) a capture-level E2E asserting PiEngine passes the resolved `options.model.api` into the session factory (engine-level config, provider override, absent default); (c) real-SDK round-trips remain in completions mode only, via a new shared test-support helper `src/bun/test/support/pi-faux-session.ts` that drives the production `createPiAgentSession`.
**Rationale:** The actual HTTP dispatch to `/v1/responses` cannot be exercised without a live server (same as completions today); the capture-level test proves the config → Model.api → engine wiring without depending on faux-provider responses-mode mechanics. Dual-mode real-SDK round-trips (`registerFauxProvider({ api: "openai-responses" })`) are deferred pending a spike after the SDK bump.
**Alternative considered:** dual-mode faux round-trips now. Rejected: uncertain plug-in mechanics via ModelRuntime; heavier scope.

## Risks / Trade-offs

- **[Risk]** Existing configs silently switch to `/v1/responses` after upgrade (new default).
  → **Mitigation:** BREAKING note in proposal; sample file documents `api: openai-completions`; validation gives clear errors on typos. Users on servers without `/v1/responses` get an explicit HTTP error they can fix with one config line.
- **[Risk]** `ModelRuntime` performs network catalog refresh at create time.
  → **Mitigation:** `refreshOnCreate: false`; Railyin registers providers itself. Asserted in `model-runtime-builder.test.ts`.
- **[Risk]** SDK 0.84.x surface drift beyond the verified API (TypeBox 1.3.7, `message_update` shape).
  → **Mitigation:** Verification shows Railyin only reads `assistantMessageEvent.delta` (present in 0.84.1) and uses pi-ai's own `Type` re-export; run the Pi test suite immediately after the bump to surface anything else.
- **[Risk]** `registerProvider` with a custom `api` per provider mismatching the `Model.api` built later.
  → **Mitigation:** both derive from `resolvePiApiMode` — single source of truth; aligned by the capture-level E2E.
- **[Risk]** The shared-factory refactor changes behavior of the child session path (system prompt, thinking level).
  → **Mitigation:** parameterization preserves the current deltas (SUBAGENT suffix, in-memory manager, inherited thinking level); `session-factory.test.ts` pins each variant; delegate suite keeps passing.
- **[Risk]** Migrating the five faux-provider test files can obscure unrelated failures.
  → **Mitigation:** migration is compile-mandatory (AuthStorage removed); done via the shared helper so all five change identically; existing scenarios keep their assertions.

## Migration Plan

1. Bump dependencies (`package.json` + `bun.lock` via `bun install`); fix any SDK surface drift surfaced by the Pi suite.
2. Add `PiApiMode` resolver + config types + validation.
3. Add `buildPiModelRuntime()` and the shared `createPiAgentSession` factory; rewire `defaultSessionFactory` (engine.ts) and `defaultChildSessionFactory` (child-session.ts) as thin wrappers.
4. Wire api mode into `PiModelBuilder` (api + compat filtering) and generalize `Model<PiApiMode>` refs.
5. Add the new test suites and the shared test-support helper; migrate the five faux-provider integration files to it.
6. Update sample configs and AGENTS.md.
7. Typecheck + run the Pi test suite + API smoke tests.
8. Manual smoke: one engine with `api: openai-completions`, one with `api: openai-responses` (or provider override).

Rollback: revert the change commit(s). Config-level rollback for the default flip: add `api: openai-completions` to existing engines.
