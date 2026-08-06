## 1. Config types & validation (Part 1)

- [ ] 1.1 In `src/bun/config/index.ts`, rename `PiModelConfig.interleaved` to `thinkingFormat?: "openai"|"openrouter"|"deepseek"|"together"|"zai"|"qwen"|"chat-template"|"qwen-chat-template"|"string-thinking"|"ant-ling"`; keep `reasoning?: boolean` and `tool_call?: boolean` (tool_call stays informational)
- [ ] 1.2 In `src/bun/engine/pi/pi-config-validation.ts`, reject an `interleaved` key with a "renamed to thinkingFormat" error and validate `thinkingFormat` against the allowed union

## 2. Model builder wiring (Part 1)

- [ ] 2.1 In `src/bun/engine/pi/model-builder.ts`, map `model.reasoning = config.reasoning ?? true` (replace hardcoded `true`)
- [ ] 2.2 Map `config.thinkingFormat` → `model.compat.thinkingFormat` when set (else leave unset for SDK auto-detection)
- [ ] 2.3 When `config.thinkingFormat === "deepseek"`, set `model.compat.requiresReasoningContentOnAssistantMessages = true`
- [ ] 2.4 Ensure no `thinkingLevelMap` and no reasoning-knob injection is added to the built model

## 3. Canonical level + applier service (Part 1)

- [ ] 3.1 In `src/bun/engine/pi/model-config.ts`, add pure helper `canonicalThinkingLevel(variantOptions)` mapping `reasoningEffort`/`reasoning_effort`/`enable_thinking`/`thinking`: `"none"`→`"off"`, valid canonical levels pass through, else fallback `"off"`
- [ ] 3.2 Create `src/bun/engine/pi/model-config-applier.ts` with `buildSettings(modelCfg): ModelSettingAxis[]` (moved from `PiEngine._buildSettings`)
- [ ] 3.3 Implement `applyToSession(session, modelCfg, modelStr, presetName, modelParams)`: resolve Mode (`modelParams`→default), compute canonical `thinkingLevel` from the variant's `reasoningEffort`, set `session.agent.state.thinkingLevel`
- [ ] 3.4 Assemble `onPayload` = spread base `options` + custom-axis runtime + sampling preset, **dropping any `reasoning_effort`/`reasoningEffort` key** (SDK-owned) while **passing through provider-specific reasoning knobs** (`enable_thinking`, `thinking`, `chat_template_kwargs`) the config declares; set `session.agent.onPayload` (or `undefined` when empty)
- [ ] 3.5 Remove the old `REASONING_KEYS`/`reasoning_effort` override logic from the moved code — the effort key is never emitted by Railyin

## 4. Wire applier into PiEngine (Part 1)

- [ ] 4.1 Construct/inject `PiModelConfigApplier` in the `PiEngine` constructor (DI, injectable for tests)
- [ ] 4.2 Replace `PiEngine._applyModelConfigToSession` body with a delegate to `applier.applyToSession(...)`
- [ ] 4.3 Replace `PiEngine._buildSettings` body with a delegate to `applier.buildSettings(...)`; update call sites (execute line ~286, listModels line ~414)

## 5. Cross-engine transfer: engine type (Part 2)

- [ ] 5.1 Add `type: EngineType` to the `ExecutionEngine` interface in `src/bun/engine/types.ts` (`"pi"|"claude"|"cursor"|"copilot"|"opencode"|"scripted"`)
- [ ] 5.2 Return the correct `type` from each engine implementation (PiEngine→"pi", ClaudeEngine→"claude", cursor→"cursor", copilot→"copilot", opencode→"opencode", scripted→"scripted")
- [ ] 5.3 Change `prepareSwitch(...)` to accept the TARGET engine's `type` as a parameter (e.g. `targetEngineType`); callers (chat/transition/human-turn executors) pass `engine.type`
- [ ] 5.4 In `src/bun/conversation/cross-engine-context.ts`, when `last_engine_type !== targetEngineId`: if `sourceEngine?.type === targetEngineType`, return `{ historyBlock: undefined }` (skip transfer)
- [ ] 5.5 Skip the conditional pre-switch `compact()` when the engine types match (same-type path)

## 6. Docs & sample config

- [ ] 6.1 Update `config/engines.yaml.sample` to the `thinkingFormat` shape (with a DeepSeek example: `reasoning: true`, `thinkingFormat: deepseek`, variants none/normal/max with `reasoningEffort` none/high/xhigh)
- [ ] 6.2 Update `AGENTS.md` documenting the breaking `interleaved`→`thinkingFormat` rename and `tool_call` as accepted-informational
- [ ] 6.3 Update the archived `pi-per-model-config` reference/spec docs for the rename if referenced

## 7. Tests — Unit (Railyin seam, primary)

- [ ] 7.1 Update `src/bun/test/pi-engine.test.ts` (via `MockAgentSession`) `PE-VARIANT-*`/`PE-THINKING-*`: assert canonical `session.agent.state.thinkingLevel` (`off` for `none`/`none`, `high` for `normal`/`high`, `xhigh` for `max`/`xhigh`); assert `onPayload` carries NO `reasoning_effort`/`reasoningEffort`
- [ ] 7.2 Add Railyin-seam no-conflict test: for None/Normal/Max variants the returned `onPayload` never contains a `reasoning_effort`/`reasoningEffort` key — this is the surface Railyin controls (note: the faux provider cannot observe the HTTP body; the SDK emits the single reasoning field from the canonical level)
- [ ] 7.3 Add provider-specific-knob tests: a variant declaring `chat_template_kwargs`/`enable_thinking` is passed through `onPayload`; a variant declaring none gets NO such keys auto-injected
- [ ] 7.4 Update `src/bun/test/pi/model-builder.test.ts`: add `reasoning:false`→`model.reasoning:false`, `thinkingFormat`→`compat.thinkingFormat`, and `thinkingFormat:"deepseek"`→`requiresReasoningContentOnAssistantMessages:true` assertions (MB-1..7 extend)
- [ ] 7.5 Update `src/bun/test/pi/model-config.test.ts`: add canonical `reasoningEffort`→level helper coverage (none→off, valid pass-through, invalid→off) and `thinkingFormat`/`reasoning` config handling (MC-* extend)
- [ ] 7.6 Update `src/bun/test/pi/config-validation.test.ts`: `interleaved` rejected with renaming error; invalid `thinkingFormat` rejected (CV-* extend)

## 8. Tests — Cross-engine transfer (unit + in-memory DB integration)

- [ ] 8.1 Update `src/bun/test/cross-engine-context.test.ts` (CEC-*): `makeSourceEngine` gains `type`; add same-type skip scenario (pi→pi: `prepareSwitch(..., "pi-deepseek", ..., targetType="pi")` returns `{ historyBlock: undefined }`); existing same-id, null, and cross-type scenarios still pass
- [ ] 8.2 Add CEC scenario: same-type switch with context >75% also skips `compact()` (both block and compact skipped)
- [ ] 8.3 Add CEC scenario: cross-type switch (pi→claude) still injects `historyBlock` and still compacts when >75%
- [ ] 8.4 Update `src/bun/test/transition-executor.test.ts` (TE-CE-*) and `chat-executor.test.ts` (CE-8/9/10) / `human-turn-executor.test.ts`: pass `engine.type` into `prepareSwitch`; add a pi→pi same-type end-to-end case asserting no `<message_history>` injection
- [ ] 8.5 Update any engine/cross-engine registry tests that construct engines for the new required `type` field (`engine-registry.test.ts`, helpers)

## 9. Tests — Playwright

- [ ] 9.1 Confirm `e2e/ui/reasoning-mode-select.spec.ts` / `sampling-preset-select.spec.ts` / `model-picker-multi-engine.spec.ts` remain valid (Mode axis shape unchanged; `models.listEnabled` is fully mocked). No new Playwright tests are required.

## 10. Verification

- [ ] 10.1 Run `bun run typecheck`
- [ ] 10.2 Run `bun test src/bun --timeout 20000` and confirm the full suite passes
- [ ] 10.3 Run the Playwright specs `bun run test:e2e:chat` (reasoning-mode/sampling-preset selectors) to confirm no UI regression
- [ ] 10.4 Confirm the DeepSeek reproduction config (optional local run) responds in all Modes (None/Normal/Max)

