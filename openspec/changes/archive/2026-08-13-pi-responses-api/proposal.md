## Why

The Pi engine pins `@earendil-works/pi-coding-agent` at `^0.80.3` (lockfile 0.80.3) while the latest release is 0.84.1, missing bugfixes and OpenAI Responses API support. The SDK removed `AuthStorage` / `CreateAgentSessionOptions.authStorage` in 0.80.8 in favor of the async `ModelRuntime` — Railyin's `defaultSessionFactory` and `defaultChildSessionFactory` still use the removed API and cannot upgrade without migrating. Separately, Railyin hardcodes `api: "openai-completions"` in `PiModelBuilder`, so every Pi model always talks to `${baseUrl}/chat/completions`; users cannot use endpoints that expose `/v1/responses` (LM Studio, vLLM, OpenAI-compatible servers are adding it).

## What Changes

- Bump `@earendil-works/pi-coding-agent` to `^0.84.1` and add `@earendil-works/pi-ai` as a direct dependency (`^0.84.1`) since it is imported directly.
- Add an `api` config option (`"openai-completions" | "openai-responses"`) to the Pi engine root (`PiEngineConfig.api`) with an optional per-provider override (`PiProviderConfig.api`). Effective mode resolution: `providers.<name>.api ?? config.api ?? "openai-responses"`.
- **BREAKING default**: when `api` is omitted, the engine now uses `openai-responses` (was completions). Existing configs must set `api: openai-completions` explicitly to keep the previous endpoint.
- Migrate session auth from the removed `AuthStorage` to `ModelRuntime`: a shared `buildPiModelRuntime(config)` helper creates `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false })` and registers every configured provider (plus the `"default"` fallback) with `baseUrl`, `apiKey`, and the resolved `api` mode.
- **Refactor**: extract the duplicated parent/child session creation into a single production `createPiAgentSession` factory (`pi-session-factory.ts`), parameterized over session manager (disk vs in-memory), system prompt (override vs subagent suffix), and thinking level. Both `defaultSessionFactory` (engine.ts) and `defaultChildSessionFactory` (child-session.ts) delegate to it — one ModelRuntime-backed path, and the real production factory becomes directly testable.
- `PiModelBuilder.build()` sets `api` from the resolved mode and returns `Model<PiApiMode>`; the hardcoded `Model<"openai-completions">` type references across the pi engine are generalized to a shared `PiApiMode` type.
- Compat handling: under `openai-responses`, completions-only compat keys (`thinkingFormat`, `requiresReasoningContentOnAssistantMessages`) are silently dropped at model-build time (no validation error); `supportsDeveloperRole: false` is injected for both modes so local servers keep receiving `system` (not `developer`) role messages.
- Update `config/engines.yaml.sample`, `config/engines.yaml` docs, and AGENTS.md.

## Capabilities

### New Capabilities

- `pi-api-mode`: config-driven selection of the OpenAI-compatible API mode (`openai-completions` | `openai-responses`) per engine with per-provider override, resolved from `engines.yaml` and applied to both the pi-ai `Model.api` and the `ModelRuntime` provider registration.

### Modified Capabilities

- `pi-engine`: Pi models are built with the resolved API mode instead of hardcoded `openai-completions`; completions-only compat keys are ignored under `openai-responses`; session creation migrates from the removed `AuthStorage` API to `ModelRuntime` and is consolidated into a single shared factory (parent and child sessions).

## Impact

- **Code**: `package.json` (version bump + direct pi-ai dep), `src/bun/config/index.ts` (types), `src/bun/engine/pi/api-mode.ts` (new resolver), `src/bun/engine/pi/model-runtime-builder.ts` (new runtime builder), `src/bun/engine/pi/pi-session-factory.ts` (new shared factory), `model-builder.ts` (api wiring + compat filtering), `engine.ts` + `child-session.ts` (ModelRuntime migration via shared factory, type generalization), `session-manager.ts`, `execution-controller.ts`, `tools/delegate.ts` (type refs), `pi-config-validation.ts` (api value validation), docs.
- **Tests**: see Test Coverage below.
- **API/RPC**: no changes. `listModels()` is unaffected (the `/models` endpoint is shared by both APIs).
- **DB**: no schema change.
- **Dependencies**: `@earendil-works/pi-coding-agent` `^0.80.3` → `^0.84.1`; `@earendil-works/pi-ai` added as direct dep `^0.84.1` (was transitive).

## Test Coverage

### Unit Tests (new/extended service suites)

- `api-mode.test.ts` (new): `resolvePiApiMode` — engine default applies to all providers; provider override wins; absent `api` → `openai-responses`; unknown provider name → engine default; unconfigured provider prefix → engine default; `"default"` (unprefixed model) provider → engine default.
- `model-builder.test.ts` (extended): MB-1 rewritten for the new default (`openai-responses`); engine-level `api` → `Model.api`; provider override → `Model.api`; `supportsDeveloperRole: false` in both modes; `thinkingFormat`/`requiresReasoningContentOnAssistantMessages` present under completions and dropped under responses (deepseek + openrouter/deepseek cases); existing MB-2..15 keep passing.
- `config-validation.test.ts` (extended): invalid `api` rejected at engine level; invalid `api` rejected at provider level; valid values pass at both levels.
- `model-runtime-builder.test.ts` (new, hermetic — `refreshOnCreate: false` + `InMemoryCredentialStore` + no models path, no network): every configured provider registered with `baseUrl`/`apiKey`/resolved api; `"default"` fallback provider registered for unprefixed models; provider override reflected in registration; `getAuth(providerId)` resolves the runtime api key (proves wiring); creation performs no catalog network refresh.
- `session-factory.test.ts` (new, real SDK + faux provider, completions round-trip): parent mode creates a session and only sets `systemPromptOverride` when non-empty; child mode appends the subagent suffix, uses in-memory SessionManager, inherits the parent thinking level; the passed `model` (with resolved api) is forwarded unchanged; provider runtime is registered for the model's provider.

### Capture-Level E2E

- `api-mode-e2e.test.ts` (new, no-output-regression pattern with an injected capture-factory): PiEngine `execute()` passes `options.model.api === "openai-responses"` to the session factory for engine-level `api: openai-responses`; `"openai-completions"` for a provider override; `"openai-responses"` when `api` is absent (default). Execution still streams tokens + done (faux round-trip in completions mode).

### Migration of Existing Integration Tests

- New shared test-support helper `src/bun/test/support/pi-faux-session.ts` centralizing `registerFauxProvider` + session creation via the production `createPiAgentSession`.
- Five faux-provider integration files migrate from their hand-rolled `AuthStorage` factories to the helper: `pi/no-output-regression.test.ts`, `pi-session-tools-integration.test.ts`, `pi-mcp-discovery-faux-provider.test.ts`, `pi-decision-streaming.test.ts`, `integration/instruction-loading.test.ts`. This is required at compile level (AuthStorage is removed in 0.84.1) and converts them from test-only factory copies to the real production path.

### Existing Suites to Keep Passing

- `bun test src/bun/test/pi --timeout 20000`
- `bun test src/bun/test/pi-engine.test.ts --timeout 20000` (in-memory DB facade suite, vitest)
- `bun test src/bun/test/pi-session-tools-integration.test.ts --timeout 20000`
- `bun test e2e/api --timeout 30000`
- Playwright UI suite (`bun run test:e2e`) — no new specs; all `/api/*` are mocked, the feature has zero UI surface.
