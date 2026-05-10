## 1. Test helper — setupTestConfig

- [ ] 1.1 In `src/bun/test/helpers.ts`, rename the `engineModel` parameter of `setupTestConfig` to `defaultModel`; keep the default value `"copilot/mock-model"`
- [ ] 1.2 In `src/bun/test/helpers.ts`, change the YAML emitted by `setupTestConfig`: write `default_model: <defaultModel>` (omit the line entirely when the value is `null`) instead of the `engine:` block
- [ ] 1.3 In `src/bun/test/helpers.ts`, always write a default `engines.yaml` (`- id: copilot\n  type: copilot`) in the temp config dir when the caller passes no `enginesYaml` argument; this ensures the mandatory-engines-yaml requirement is satisfied for every existing test that does not opt in

## 2. Config loader — error path tests (engines-config.test.ts)

- [ ] 2.1 Delete test EC-3 ("falls back to workspace.yaml `engine:` when `engines.yaml` is absent") — this path becomes an error after the breaking change
- [ ] 2.2 Delete test EC-7 ("invalid entries in `engines.yaml` fall back to workspace engine") — fallback removed
- [ ] 2.3 Delete test EC-8 ("empty `engines.yaml` list falls back to workspace engine") — fallback removed
- [ ] 2.4 Rename/rewrite the existing EC-4 ("engines.yaml wins over workspace.yaml engine:") into a new test `EC-ERR-1`: assert that `loadConfig()` returns a non-null `error` (containing a migration hint) when `workspace.yaml` includes an `engine:` block
- [ ] 2.5 Add test `EC-ERR-2`: write a config dir with no `engines.yaml`; assert `loadConfig().error` is non-null
- [ ] 2.6 Add test `EC-ERR-3`: write a config dir with `engines.yaml` that is a valid YAML array but has zero entries; assert `loadConfig().error` is non-null
- [ ] 2.7 Add test `EC-DM-1`: write `workspace.yaml` with `default_model: copilot/gpt-4.1`; assert `config.defaultModel === "copilot/gpt-4.1"`
- [ ] 2.8 Add test `EC-DM-2`: write `workspace.yaml` without `default_model`; assert `config.defaultModel === null`
- [ ] 2.9 Update remaining EC-1, EC-2, EC-5, EC-6 fixtures to use `default_model:` instead of `engine:` and to rely on the auto-written `engines.yaml` from the `setupTestConfig` helper

## 3. OpenCode config tests (opencode-config.test.ts)

- [ ] 3.1 Rewrite test "loads successfully with engine.type: opencode and a provider with api_key" — move the `opencode` engine into a separate `engines.yaml` fixture; `workspace.yaml` gets only `default_model: opencode/anthropic/claude-sonnet-4-5`
- [ ] 3.2 Rewrite test "loads successfully with engine.type: opencode and no providers" — same migration; `workspace.yaml` has no `default_model`
- [ ] 3.3 Rewrite test "loads successfully with local LLM provider using npm and base_url" — move provider config into `engines.yaml`; assert `config.engines[0].config.providers.ollama.base_url`
- [ ] 3.4 Rewrite test "loads successfully with multiple providers configured" — move both providers into `engines.yaml`; assert `Object.keys(config.engines[0].config.providers)` contains both keys

## 4. Workspace handler tests (workspace-handlers.test.ts)

- [ ] 4.1 Update the fixture in the `beforeEach` / `makeConfigDir` call (line 56–69) to emit `default_model: copilot/mock-model` instead of the `engine:` block; ensure an `engines.yaml` is also present in the temp dir (the helper change in task 1.3 covers this automatically if `setupTestConfig` is used)
- [ ] 4.2 Update test `WH-1` (workspace.getConfig response): assert the response contains `defaultModel: "copilot/mock-model"` and does **not** contain an `engine` key
- [ ] 4.3 Delete test that asserts `raw` content contains `"type: copilot"` (line 97) — the `DEFAULT_WORKSPACE_YAML` no longer has an `engine:` block
- [ ] 4.4 Update `WH-3` (workspace.update with model): pass `{ defaultModel: "claude/claude-sonnet-4-5" }` to `workspace.update`; assert the persisted file contains `default_model: claude/claude-sonnet-4-5` and no `engine:` key
- [ ] 4.5 Delete the "derives engine type from model prefix" and "deep-merges engine block" tests (lines 109–133) — those branches no longer exist in the implementation

## 5. Task seeding handler tests (handlers.test.ts)

- [ ] 5.1 Collapse the 21 identical TC-1 test bodies (one per workflow column fixture) into a single test: assert `conversation.model` is seeded from `config.defaultModel` when a task is created or transitioned
- [ ] 5.2 Add test `TC-2`: configure `setupTestConfig` with `defaultModel: null`; create a task and assert `conversation.model` is `null` (no engine fallback)

## 6. Engine registry tests — mechanical cleanup (engine-registry.test.ts)

- [ ] 6.1 In the `makeConfig` helper (line 31), remove the `engine: { type: engineIds[0] ?? "copilot" }` field from the returned `LoadedConfig` literal — the field no longer exists on the type after the breaking change; no behavior change since `EngineRegistry` never reads it

## 7. Multi-engine execution tests — mechanical cleanup (multi-engine-execution.test.ts)

- [ ] 7.1 In the `makeConfig` helper (line ~57), apply the same `engine:` field removal as task 6.1

## 8. Chat session handler tests

- [ ] 8.1 Add test `CS-1`: call `chatSessions.sendMessage` with a session whose conversation has no model set; assert `conversation.model` is seeded from `config.defaultModel` (not `config.engine.model`)
- [ ] 8.2 Add test `CS-2`: set up a conversation with `model: "claude/claude-sonnet-4-5"`; send a message with an `@file:` attachment; assert the file reference is resolved in the content (confirming the engine ID derived from the model prefix is used for attachment routing)
- [ ] 8.3 Add test `CS-3`: same as CS-2 but via `chatSessions.submitDecisions`; assert the same attachment-resolution behavior

## 9. Attachment routing unit tests

- [ ] 9.1 Add test `AR-1`: call `prepareMessageForEngine("copilot", content, attachments)` where attachments include a `@file:` reference; assert content is unchanged and attachment list is unmodified
- [ ] 9.2 Add test `AR-2`: call `prepareMessageForEngine("claude", content, attachments)` with a `@file:path` reference attachment; assert the file path is resolved into the content and the file-reference attachment is removed from the returned list

## 10. Playwright — workspace settings UI (workspace-settings.spec.ts)

- [ ] 10.1 In `e2e/ui/fixtures/mock-data.ts` (`makeWorkspace()`), replace `engine: { model: "copilot/gpt-4.1" }` with `defaultModel: "copilot/gpt-4.1"` so all existing workspace mock fixtures use the new field
- [ ] 10.2 Add test `W-6`: navigate to the Workspace settings tab; change the model dropdown selection; click "Save settings"; assert `workspace.update` is called with `{ defaultModel: "copilot/gpt-4.1" }` (not `engineModel`)
- [ ] 10.3 Add test `W-7`: use `makeWorkspace({ defaultModel: "copilot/gpt-4.1" })`; navigate to Workspace settings; assert the model dropdown shows "GPT-4.1" as the pre-selected value
- [ ] 10.4 Add test `W-8`: use `makeWorkspace({ defaultModel: null })`; navigate to Workspace settings; assert the model dropdown has no value selected (placeholder shown)

## 11. Verification

- [ ] 11.1 Run `bun test src/bun/test --timeout 20000` — all backend unit and integration tests green
- [ ] 11.2 Run `bun run build && npx playwright test e2e/ui` — all UI tests green including the new W-6/W-7/W-8 cases
