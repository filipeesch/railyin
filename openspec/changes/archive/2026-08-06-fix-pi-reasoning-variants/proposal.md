## Why

With the `pi-local` engine, a DeepSeek model served via OpenRouter **responds when Mode=None but produces no response in Mode=Normal/Max**. Root cause: two actors write reasoning params into the request body — the pi SDK (from `session.agent.state.thinkingLevel` via auto-detected `compat.thinkingFormat`) and Railyin's `onPayload` (merging `reasoning_effort`). Because the Mode variant ids (`normal`/`max`) are not valid SDK thinking levels, the SDK clamps to `off` and emits one reasoning field while Railyin injects a conflicting `reasoning_effort` on top → the provider rejects the conflicting body → no response. The `interleaved`/`reasoning`/`tool_call` per-model config fields are dead code (never wired into the SDK model).

This also surfaced a second, related flaw in the user's intended workflow (multiple `pi` engine entries for different provider configs): switching between two engine entries of the **same type** (e.g. `pi-local` → `pi-deepseek`) fires the lossy cross-engine context transfer even though both share the same per-conversation session JSONL, so the transfer is redundant and harmful.

## What Changes

**— Part 1: Pi reasoning ownership (fixes the DeepSeek no-response) —**

- **Let the SDK own reasoning**: `PiModelConfigApplier` maps each Mode variant's `reasoningEffort` to a canonical SDK thinking level (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`, `"none"`→`"off"`) and sets `session.agent.state.thinkingLevel`; Railyin **stops** injecting reasoning knobs (`reasoning_effort`/`thinking`/`enable_thinking`) via `onPayload`. The SDK emits exactly one consistent reasoning field per `compat.thinkingFormat`.
- **Wire dead config into the model builder**: `reasoning` → `model.reasoning`; `thinkingFormat` → `model.compat.thinkingFormat`; `thinkingFormat: "deepseek"` → `compat.requiresReasoningContentOnAssistantMessages = true`. No cross-provider value remapping (`thinkingLevelMap`) is added — the variant's `reasoningEffort` IS the canonical level.
- **BREAKING config rename**: `interleaved` → `thinkingFormat` (values `openai|openrouter|deepseek|together|zai|qwen|chat-template|qwen-chat-template|string-thinking|ant-ling`). Invalid `interleaved` is rejected with a clear "renamed" error.
- **Extract `PiModelConfigApplier`**: pull `_applyModelConfigToSession` and `_buildSettings` out of the large `PiEngine` class into an injectable service (DI), reducing the god class.

**— Part 2: Cross-engine context-transfer fix (skips lossy transfer for same-type engines) —**

- **Compare engine TYPE, not id** in `CrossEngineContextInjector.prepareSwitch`: when source and target engines have the same engine type (e.g. two `pi` entries), no context transfer is performed — they already share the same per-conversation session storage.
- **Skip both** the `<message_history>` block injection **and** the conditional pre-switch `compact()` when the engine types match.
- Add engine `type` to the `ExecutionEngine` interface (currently absent); the target engine's type is passed into `prepareSwitch` by the caller (the injector resolves only the source from the registry). opencode caveat accepted (broken/not in use).

## Capabilities

### New Capabilities
- `pi-model-config-applier`: New injectable service that resolves a Pi model's per-model config (Mode variants, sampling presets, axes) into a canonical session thinking level and an `onPayload` request-body merge, owning the SDK-mapping contract (variant `reasoningEffort` = canonical SDK level; the SDK owns the reasoning-effort key and provider-specific reasoning knobs stay forwardable through `onPayload` for per-model flexibility).

### Modified Capabilities
- `pi-engine`: Per-model reasoning config now takes effect — `reasoning`→`model.reasoning`, `thinkingFormat` (renamed from `interleaved`)→`compat.thinkingFormat`/`requiresReasoningContentOnAssistantMessages`; Mode variants drive the SDK through a canonical `thinkingLevel`; Railyin no longer emits a conflicting `reasoning_effort`/`reasoningEffort` via `onPayload` (provider-specific knobs like `enable_thinking`/`chat_template_kwargs` may still pass through); no conflicting reasoning-effort keys in any Mode.
- `cross-engine-context-injection`: Context transfer is skipped when the previous and target engines share the same engine **type** (both block injection and pre-switch compaction), because same-type engines share the same per-conversation session storage.

## Impact

- **Code**: `src/bun/config/index.ts` (config types + rename), `src/bun/engine/pi/pi-config-validation.ts`, `src/bun/engine/pi/model-builder.ts`, `src/bun/engine/pi/model-config.ts`, NEW `src/bun/engine/pi/model-config-applier.ts`, `src/bun/engine/pi/engine.ts` (delegate to applier), `src/bun/engine/types.ts` (add `ExecutionEngine.type`), every engine impl (pi/claude/cursor/copilot/opencode/scripted), `src/bun/conversation/cross-engine-context.ts`.
- **Config/deps**: `interleaved` → `thinkingFormat` is a **BREAKING** per-model config rename (documented in `config/engines.yaml.sample` + `AGENTS.md`). No new runtime dependency.
- **Tests**: `src/bun/test/pi-engine.test.ts` (PE-VARIANT/PE-THINKING updates), provider-level reasoning-body test, `src/bun/test/cross-engine-context.test.ts` (same-type skip, cross-type transfer).
