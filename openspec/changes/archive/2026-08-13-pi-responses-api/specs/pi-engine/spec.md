## MODIFIED Requirements

### Requirement: Session creation via ModelRuntime
Pi session creation SHALL authenticate and register providers through `ModelRuntime` instead of the removed `AuthStorage` API: an in-memory credential store, `refreshOnCreate: false`, no models path, and one `registerProvider` call per configured provider (plus the `"default"` fallback) carrying `baseUrl`, `apiKey` (fallback `"no-key"`), and the resolved api mode.

#### Scenario: Parent session registers configured providers
- **WHEN** `defaultSessionFactory` creates a session for a config with `providers: { lmstudio: { base_url, api_key } }`
- **THEN** the runtime registers provider `lmstudio` with that baseUrl/apiKey and the resolved api, and `createAgentSession` receives the `modelRuntime`

#### Scenario: Child session uses the same runtime pattern
- **WHEN** `defaultChildSessionFactory` creates a delegate session
- **THEN** it uses the same `buildPiModelRuntime` pattern with in-memory credentials and no network refresh

#### Scenario: Unprefixed model provider fallback registered
- **WHEN** a model id has no provider prefix and the engine declares no matching provider
- **THEN** the `"default"` provider is registered with the fallback baseUrl (`http://localhost:1234/v1`) and the resolved api so auth resolution succeeds

#### Scenario: Runtime auth resolves the registered api key
- **WHEN** a provider was registered with an explicit api key (or the `"no-key"` fallback)
- **THEN** `getAuth(providerId)` resolves that key through the runtime, proving the registration wiring

#### Scenario: Runtime creation performs no catalog refresh
- **WHEN** `buildPiModelRuntime` creates the runtime
- **THEN** creation succeeds without any network catalog refresh (providers are registered by Railyin)

### Requirement: Shared session creation path for parent and child factories
The parent (`defaultSessionFactory`) and child (`defaultChildSessionFactory`) session factories SHALL delegate to a single shared `createPiAgentSession` factory, parameterized over session manager (disk-backed for parent, in-memory for child), system prompt (override only when non-empty for parent; always-override with the subagent suffix for child), and thinking level (child inherits the parent's resolved level).

#### Scenario: Parent factory delegates to shared factory
- **WHEN** `defaultSessionFactory` is invoked with a non-empty system prompt
- **THEN** the session is created through the shared factory with a disk-backed session manager and `systemPromptOverride` set only when the prompt is non-empty

#### Scenario: Child factory delegates with subagent suffix and in-memory manager
- **WHEN** `defaultChildSessionFactory` is invoked
- **THEN** the session is created through the shared factory with an in-memory session manager, the SUBAGENT suffix appended to the system prompt, and the parent's resolved thinking level applied to the session

#### Scenario: Resolved api mode forwarded into the session factory
- **WHEN** PiEngine executes a turn with a config resolving to `openai-responses` (engine-level, provider override, or default)
- **THEN** the session factory receives a `Model` whose `api` equals the resolved mode, and the execution still streams tokens followed by `done` (faux provider, completions round-trip)

### Requirement: Completions-only compat keys ignored under openai-responses
The model builder SHALL include `supportsDeveloperRole: false` in the model compat for both api modes, and SHALL include completions-only compat keys (`thinkingFormat`, `requiresReasoningContentOnAssistantMessages`) only when the resolved mode is `openai-completions`; under `openai-responses` those keys are silently omitted.

#### Scenario: thinkingFormat dropped under responses
- **WHEN** a model config sets `thinkingFormat: deepseek` and the resolved mode is `openai-responses`
- **THEN** the built `Model.compat` contains `supportsDeveloperRole: false` but no `thinkingFormat` key, and no validation error is raised

#### Scenario: thinkingFormat kept under completions
- **WHEN** a model config sets `thinkingFormat: deepseek` and the resolved mode is `openai-completions`
- **THEN** the built `Model.compat` contains both `thinkingFormat: "deepseek"` and `supportsDeveloperRole: false`

#### Scenario: supportsDeveloperRole false in both modes
- **WHEN** a model is built under either resolved mode
- **THEN** `Model.compat.supportsDeveloperRole` is `false` (local servers receive `system`, not `developer`, role messages)

#### Scenario: OpenRouter-served DeepSeek flag dropped under responses
- **WHEN** a model config sets `thinkingFormat: openrouter` for a DeepSeek model and the resolved mode is `openai-responses`
- **THEN** `requiresReasoningContentOnAssistantMessages` is absent from `Model.compat`

### Requirement: Type references generalized to PiApiMode
All Pi engine components that reference the model type (`SessionFactoryOptions`, session manager, execution controller, child session options, delegate tool options) SHALL use `Model<PiApiMode>` instead of `Model<"openai-completions">`.

#### Scenario: Engine compiles with responses-mode models
- **WHEN** the codebase type-checks with a `Model` whose api is `"openai-responses"`
- **THEN** every Pi engine component accepts it without casts beyond the model-builder construction site
