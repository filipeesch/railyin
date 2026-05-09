## 1. Shared types

- [ ] 1.1 In `src/shared/rpc-types.ts`, replace `WorkspaceConfig.engine: { model? }` with `defaultModel: string | null`
- [ ] 1.2 In `src/shared/rpc-types.ts`, on `workspace.update.params`, rename `engineModel?: string` to `defaultModel?: string`

## 2. Config loader — schema cleanup

- [ ] 2.1 In `src/bun/config/index.ts`, delete the `engine?: EngineConfig` field from `WorkspaceYaml`
- [ ] 2.2 In `src/bun/config/index.ts`, on `WorkspaceYaml.default_model`, drop the `@deprecated` tag and add a docstring noting the canonical `<engineId>/<modelId>` format
- [ ] 2.3 In `src/bun/config/index.ts`, delete the `engine: EngineConfig` field from `LoadedConfig`
- [ ] 2.4 In `src/bun/config/index.ts`, add `defaultModel: string | null` to `LoadedConfig`
- [ ] 2.5 In `src/bun/config/index.ts`, in `mergeWorkspaceDefaults`, delete the engine merge branch (the `if (defaults.engine || workspace.engine)` block)
- [ ] 2.6 In `src/bun/config/index.ts`, in `patchWorkspaceYaml`, delete the engine deep-merge branch (the `if (patch.engine && current.engine)` block)
- [ ] 2.7 In `src/bun/config/index.ts`, remove the `workspaceEngine?: EngineConfig` parameter from `loadEnginesConfig` and delete the precedence-warning log

## 3. Config loader — engine resolution rewrite

- [ ] 3.1 In `src/bun/config/index.ts` (`loadConfig`), replace the entire engine-resolution block with: (a) error if `workspace.engine` is present (clear migration message per design D7); (b) error if `engines.yaml` is missing; (c) error if `loadEnginesConfig` returns no entries; (d) read `workspace.default_model` and store it on `LoadedConfig.defaultModel`
- [ ] 3.2 In `src/bun/config/index.ts` (`loadConfig`), simplify the `engines` field initializer to `loadEnginesConfig(configDir) ?? loadEnginesConfig(globalConfigDir)` and treat null as the error in 3.1c
- [ ] 3.3 In `src/bun/config/index.ts` (`ensureConfigExists`), also write a default `engines.yaml` (one `copilot` entry) when missing on first launch

## 4. Engine registry & model resolver

- [ ] 4.1 In `src/bun/engine/execution/model-resolver.ts` (`seedConversationModel`), drop the first-engine-model fallback at lines 47–48; the precedence becomes `config.defaultModel` only, with `null` meaning "leave conversation.model unset"
- [ ] 4.2 Verify `EngineRegistry.getDefaultEngine` continues to work — it already iterates `config.engines`, no change needed; add a unit test asserting it picks the first allowed engine

## 5. Backend handlers

- [ ] 5.1 In `src/bun/handlers/workspace.ts` (`workspace.getConfig`), replace the `engine: { model: ... }` response field with `defaultModel: config.defaultModel`
- [ ] 5.2 In `src/bun/handlers/workspace.ts` (`workspace.update`), accept `defaultModel?: string` instead of `engineModel?: string`; write `patch.default_model = params.defaultModel || undefined` (no prefix-derive logic)
- [ ] 5.3 In `src/bun/handlers/tasks.ts` lines 314 and 329, replace `getWorkspaceConfig(taskWorkspaceKey).engine.type` with `QualifiedModelId.tryParse(conversationModel)?.engineId ?? "copilot"` where `conversationModel` is already available from the conversation row fetched earlier in the handler
- [ ] 5.4 In `src/bun/handlers/chat-sessions.ts` line 50, replace the `engine.model` read with `getWorkspaceConfig(...).defaultModel`
- [ ] 5.5 In `src/bun/handlers/chat-sessions.ts` (`chatSessions.sendMessage`, line ~116), extend the SELECT to `LEFT JOIN conversations c ON c.id = cs.conversation_id` and project `c.model AS conversationModel`; use `QualifiedModelId.tryParse(conversationModel)?.engineId ?? "copilot"` at lines 131 for attachment routing (replaces `workspaceConfig.engine.type`)
- [ ] 5.6 In `src/bun/handlers/chat-sessions.ts` (`chatSessions.submitDecisions`, line ~169), apply the same `LEFT JOIN conversations` extension and replace the `engine.type` read at line 184 with `QualifiedModelId.tryParse(conversationModel)?.engineId ?? "copilot"`

## 6. Sample configs and constants

- [ ] 6.1 In `config/workspace.yaml.sample`, delete the entire "Single-engine fallback (backward compat)" section and the commented `engine:` examples; add a commented `# default_model: copilot/claude-sonnet-4.6` example near `allowed_engines`
- [ ] 6.2 In `config/engines.yaml.sample`, delete the "When this file is absent, falls back…" sentence; ensure the file documents itself as required
- [ ] 6.3 In `src/bun/config/index.ts`, update the `DEFAULT_WORKSPACE_YAML` constant (lines 451–471) — remove the `engine:` block lines entirely and add a `# default_model: <engineId>/<modelId>` comment line in its place so first-launch generated configs no longer include the legacy field

## 7. Frontend

- [ ] 7.1 In `src/mainview/stores/workspace.ts`, rename the `update({ engineModel })` action signature/payload to `update({ defaultModel })`; adjust the model-provider extraction (line 118) to read from `defaultModel`
- [ ] 7.2 In `src/mainview/views/SetupView.vue`, rename `wsForm.engineModel` to `wsForm.defaultModel`; load via `wsForm.defaultModel = cfg.defaultModel ?? null` (line 438); pass `defaultModel: wsForm.defaultModel ?? undefined` to `workspace.update` (line 476); reset to `null` on form reset (line 444); update the `v-model` binding (line 71) and selected-model lookup (line 395)

## 8. Test helpers and fixtures

- [ ] 8.1 In `src/bun/test/helpers.ts`, rename `setupTestConfig`'s `engineModel` parameter to `defaultModel` and update its default value to `"copilot/mock-model"`; emit `default_model: <value>` instead of an `engine:` block in the generated `workspace.test.yaml`; when the caller passes `null`, omit the `default_model:` line entirely
- [ ] 8.2 In `src/bun/test/helpers.ts`, always write a default `engines.yaml` (one entry: `id: copilot`, `type: copilot`) when the caller passes no `enginesYaml`
- [ ] 8.3 In `config/workspace.test.yaml`, replace the `engine:` block with `default_model: copilot/mock-model` and add the matching `engines.yaml` (or co-located default) so existing tests continue to pass
- [ ] 8.4 In `src/bun/test/project-registration-paths.test.ts` (line 107) and `e2e/api/fixtures/server.ts` (lines 55–57), replace each fixture's `engine:` block with `default_model: copilot/mock-model`
- [ ] 8.5 In `e2e/ui/fixtures/mock-data.ts` (line 48), replace the mock `engine: { model: "copilot/gpt-4.1" }` field with `defaultModel: "copilot/gpt-4.1"`

## 9. Test updates

- [ ] 9.1 In `src/bun/test/engines-config.test.ts`, delete EC-3, EC-7, and EC-8 (fallback-to-workspace-engine cases)
- [ ] 9.2 In `src/bun/test/engines-config.test.ts`, update remaining cases (EC-1, EC-2, EC-4, EC-5, EC-6) so their fixtures no longer set `engineModel` via the `engine:` block and rely on `engines.yaml` plus `default_model`
- [ ] 9.3 Add a new test in `src/bun/test/engines-config.test.ts` (or a sibling file) asserting `loadConfig` returns an error when `workspace.yaml` contains an `engine:` block
- [ ] 9.4 Add a new test asserting `loadConfig` returns an error when `engines.yaml` is missing
- [ ] 9.5 Add a new test asserting `LoadedConfig.defaultModel` is populated from `workspace.yaml default_model`
- [ ] 9.6 Add a new test asserting `LoadedConfig.defaultModel` is `null` when `workspace.yaml` omits `default_model`
- [ ] 9.7 In `src/bun/test/workspace-handlers.test.ts` (lines 115/118/126/129), update both tests to pass `defaultModel:` instead of `engineModel:`; rename test titles to drop "engine type from model prefix" / "deep-merges engine block" wording (those branches are gone)
- [ ] 9.8 In `src/bun/test/handlers.test.ts`, update the seeding tests that reference `engine.model` to read from `default_model` only
- [ ] 9.9 In `src/bun/test/opencode-config.test.ts` (lines 60, 82) and `src/bun/test/multi-engine-execution.test.ts` (line 57), update the assertions/fixtures to use `engines[0]` and the new schema

## 10. Manual verification

- [ ] 10.1 Run `bun test src/bun/test --timeout 20000` — full backend suite green
- [ ] 10.2 Run `bun test e2e/api --timeout 30000` — API smoke tests green
- [ ] 10.3 Run `bun run build && npx playwright test e2e/ui` — UI tests green
- [ ] 10.4 Manually start the dev server with a sample `workspace.yaml` containing only `default_model:` and confirm task execution selects the correct engine
- [ ] 10.5 Manually rename `engines.yaml` away and confirm the loader emits the configuration error per design D7
- [ ] 10.6 Manually add `engine:` back to `workspace.yaml` and confirm the loader emits the migration error
