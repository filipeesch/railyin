## Context

The Pi engine (`src/bun/engine/pi/`) builds an `@earendil-works/pi-ai` SDK `Model` from engine config and runs an `AgentSession` per conversation. Per-model config lives at engine level (`PiEngineConfig.models.<id>`), mirroring opencode: `name`, `reasoning`, `tool_call`, `interleaved`, `options`, `variants` (Mode axis), `sampling_presets`, `axes`.

**The bug:** with DeepSeek served via OpenRouter, Mode=None responds but Mode=Normal/Max produces no response. Verifiable against SDK `@earendil-works/pi-ai@0.80.3`:

1. `_applyModelConfigToSession` (engine.ts) writes the raw variant id (`normal`/`max`) into `session.agent.state.thinkingLevel` AND merges `reasoning_effort` into `onPayload`.
2. Agent's `createLoopConfig` passes `reasoning = thinkingLevel` → SDK `streamSimple` → `clampThinkingLevel(model, "normal")`. `"normal"`/`"max"` are not valid levels (`off|minimal|low|medium|high|xhigh`), so they clamp to `off` → `reasoningEffort` undefined.
3. SDK `buildParams` emits its own reasoning field per `compat.thinkingFormat` (auto-detected `"openrouter"` → `reasoning:{effort:"none"}`).
4. Railyin's `onPayload` spreads `...mergedOptions` → `reasoning_effort:"high"/"max"` on top.

Result: a body with BOTH `reasoning:{effort:"none"}` (SDK) and `reasoning_effort:"high"/"max"` (Railyin) → conflicting instructions → provider rejects/mishandles → no response. Mode=None "works" only because both sides coincidentally emit `"none"`.

**Related flaw:** the `interleaved`/`reasoning`/`tool_call` config fields are dead — `PiModelBuilder.build()` hardcodes `reasoning:true` and never reads them, never sets `compat.thinkingFormat`/`requiresReasoningContentOnAssistantMessages`.

**Second issue (from the user's intended config):** switching between two `pi` engine entries for different provider configs fires `CrossEngineContextInjector.prepareSwitch` because it compares exact engine ids (`last_engine_type === targetEngineId`). Same-type Pi entries share the same per-conversation session JSONL, so the transfer is redundant and harmful (duplicates history). Engine families that share session storage: `pi` (conversation-keyed JSONL) and `claude` (deterministic `claudeSessionIdForConversation`). `opencode` does NOT (per-instance `sessionMap` + fresh `client.session.create`) — but opencode is broken/not in use, so that caveat is accepted.

## Goals / Non-Goals

**Goals:**
- Make DeepSeek (and any reasoning model) respond in ALL Modes (None / Normal / Max) with a single, consistent reasoning request body.
- Make the per-model `reasoning`/`thinkingFormat` config fields actually take effect (wired into the SDK model), and remove the dead-code confusion.
- Avoid the lossy cross-engine context transfer when switching between same-type engine entries (e.g. two `pi` entries).
- Extract the per-model config application into an injectable `PiModelConfigApplier` service (reduce the `PiEngine` god class).

**Non-Goals:**
- No `thinkingLevelMap` config field — the variant's `reasoningEffort` is the canonical SDK level; the SDK owns provider wire-value translation.
- No tool-call gating: `tool_call` stays accepted-but-informational (tools already work via the SDK's `context.tools`; wiring a disable is orthogonal).
- No shared in-memory Pi session across engine instances (would require a shared `PiSessionManager`; out of scope). Same-type switches still re-create + replay the same JSONL, which preserves context.
- No changes to Copilot/Claude/Cursor/OpenCode behavior beyond reporting an engine `type`.

## Decisions

### D1 — Let the SDK own the reasoning-effort knob (no `thinkingLevelMap`)
`PiModelConfigApplier` maps the selected variant's `reasoningEffort` to a canonical SDK level and sets `session.agent.state.thinkingLevel`. The `reasoning_effort`/`reasoningEffort` key is **owned by the SDK** and is **removed** from `onPayload`; the SDK's `buildParams`/`thinkingFormat` then emits exactly one correct reasoning-effort field per provider. To keep per-model flexibility, provider-specific reasoning knobs that are NOT the effort key (`enable_thinking`, `thinking`, `chat_template_kwargs`) MAY still be forwarded through `onPayload` when the config declares them — different models need different reasoning args.

Canonical mapping (pure helper in `model-config.ts`):
```
variant.reasoningEffort:
  "none"  → "off"
  "minimal"|"low"|"medium"|"high"|"xhigh" → as-is (already valid SDK levels)
  anything else → "off" (fallback)
```

Config shape stays at engine-level `models.<id>`; the SDK (`clampThinkingLevel`/`getSupportedThinkingLevels`) works entirely in the canonical level space.

**Alternatives considered:** (a) Railyin owns reasoning via `onPayload` — rejected, re-introduces the fragile override that caused the bug and duplicates SDK logic; (b) `thinkingLevelMap` to remap canonical→provider values — rejected by the user: the variant's `reasoningEffort` already expresses the desired SDK level directly.

### D2 — Variant `reasoningEffort` IS the mapping; the variant name is only the UI label
The Mode axis option label/name (`none`/`normal`/`max`) drives the UI. The variant's `options.reasoningEffort` is the SDK canonical level. Users write canonical levels in `reasoningEffort`; e.g.:
```yaml
variants:
  none:   { label: "None",   options: { reasoningEffort: "none" } }
  normal: { label: "Normal", options: { reasoningEffort: "high" } }
  max:    { label: "Max",    options: { reasoningEffort: "xhigh" } }
```
For DeepSeek, `reasoningEffort:"xhigh"` (canonical) is what the SDK sends; DeepSeek's native `reasoning_effort: max` is expressed by the SDK's `deepseek` thinkingFormat emitting `reasoning_effort` from the canonical level. The variant name is never written into `thinkingLevel`.

### D3 — Wire `reasoning`/`thinkingFormat` into `PiModelBuilder.build()`
- `model.reasoning = cfg.reasoning ?? true` (was hardcoded `true`).
- `model.compat.thinkingFormat = cfg.thinkingFormat` when set (else SDK auto-detects from baseUrl).
- When `cfg.thinkingFormat === "deepseek"` → `model.compat.requiresReasoningContentOnAssistantMessages = true` (correctly replays `reasoning_content` on assistant messages).
- Keep `compat.supportsDeveloperRole: false`. No `thinkingLevelMap`.

**Alternatives:** expose `thinkingFormat` as a second field alongside a dead `interleaved` — rejected (two names for one concept). Auto-detect only — rejected (can't express DeepSeek `reasoning_content` replay via OpenRouter's openrouter detection).

### D4 — Rename `interleaved` → `thinkingFormat` (BREAKING), reject the old key
- `PiModelConfig.interleaved` is replaced by `thinkingFormat: "openai"|"openrouter"|"deepseek"|"together"|"zai"|"qwen"|"chat-template"|"qwen-chat-template"|"string-thinking"|"ant-ling"`.
- `validatePiEngineConfig` rejects an unknown `interleaved` key with a "renamed to thinkingFormat" error, and validates `thinkingFormat` against the union.
- Update `config/engines.yaml.sample`, `AGENTS.md`, and the pi-per-model-config docs.

**Alternatives:** keep `interleaved` as a deprecated alias — rejected (no working usage; a clean rename with a helpful validation message is simpler and honest).

### D5 — Extract `PiModelConfigApplier` (injectable, DI)
New `src/bun/engine/pi/model-config-applier.ts`:
- `buildSettings(cfg): ModelSettingAxis[]` — moved from `PiEngine._buildSettings` (Mode from variants, Sampling from presets, axes).
- `applyToSession(session, cfg, modelStr, presetName, modelParams)` — moved from `PiEngine._applyModelConfigToSession`:
  1. resolve Mode (`modelParams` override → config default);
  2. compute canonical `thinkingLevel` from the variant's `reasoningEffort`;
  3. **remove** the old `REASONING_KEYS`/`reasoning_effort` override — the effort key is never emitted by Railyin;
  4. assemble `onPayload` = spread base `options` + axis runtime + sampling, **dropping `reasoning_effort`/`reasoningEffort`** (SDK-owned) while **passing through provider-specific reasoning knobs** (`enable_thinking`, `thinking`, `chat_template_kwargs`) the config declares;
  5. set `session.agent.state.thinkingLevel` = canonical level.

`PiEngine` takes the applier via constructor (built like `PiModelBuilder`); tests inject a fake. Delegate `_applyModelConfigToSession`/`_buildSettings` to it.

### D6 — Cross-engine transfer: compare engine TYPE, not id
- Add `type: EngineType` (`"pi"|"claude"|"cursor"|"copilot"|"opencode"|"scripted"`) to `ExecutionEngine` (currently absent); each engine returns its type.
- `prepareSwitch` receives the TARGET engine's `type` as a parameter (each caller passes `engine.type`); the source engine's type is resolved from the registry. When `sourceEngine?.type === targetEngineType`, the injector skips the transfer (returns `{ historyBlock: undefined }`) **and** skips the conditional pre-switch `compact()`. Same-type engines share per-conversation session storage, so the fresh agent replays the same session and needs neither the message block nor a pre-transfer compaction.
- The injector never resolves the target engine itself (keeps it a pure function of source-from-registry + target-type-arg — cleaner DI; unit tests register only the source and pass the target type directly).
- Cross-type switches (and unknown source) still transfer as today.

**Rationale:** raw type equality is correct for `pi` (shared JSONL) and `claude` (shared deterministic session id). It is provably wrong for `opencode` (per-instance sessions) — but opencode is broken/not in use, so the caveat is accepted per the user. Cursor/copilot are treated by `type` equality; if a future engine stops sharing sessions, a richer `sessionFamily` marker can be introduced.

**Alternatives:** a `sessionFamily` marker on `ExecutionEngine` — technically more correct but rejected by the user (wants raw type equality; opencode not in use).

## Risks / Trade-offs

- **openCode regression (type-equality skips a needed transfer)** → Accepted: opencode is broken/not in use. If opencode is ever revived, add a `sessionFamily`-style marker rather than raw type equality.
- **`interleaved`→`thinkingFormat` is a breaking config rename** → Rejected `interleaved` is dead (no working usage); validation gives a clear migration error; sample config + AGENTS.md document it.
- **Same-type switch still re-creates the AgentSession** (not the same in-memory object) → The shared JSONL replay preserves context, so correctness holds; the cost is a re-open. Out of scope to share in-memory sessions.
- **`reasoningEffort:"xhigh"` semantics vary per provider** → The SDK's `thinkingFormat` owns provider wire-value translation; users express the canonical SDK level, and provider quirks are the SDK's responsibility. No cross-provider logic in Railyin.
- **Sampling/options still don't propagate to delegate child sessions** (pre-existing) → Child inherits canonical `thinkingLevel`; `onPayload` is per-session and not inherited. Out of scope, noted for follow-up.

## Migration Plan

1. Update config types (`PiModelConfig`) — rename `interleaved`→`thinkingFormat`, keep `reasoning`, keep `tool_call` informational.
2. Add `thinkingFormat` union validation + reject `interleaved`.
3. Wire `PiModelBuilder.build()` (reasoning, thinkingFormat, requiresReasoningContentOnAssistantMessages).
4. Extract `PiModelConfigApplier` and delegate from `PiEngine`.
5. Add `ExecutionEngine.type` + set it on each engine.
6. Update `CrossEngineContextInjector.prepareSwitch` to compare type and skip both block + compact.
7. Update `config/engines.yaml.sample` + `AGENTS.md`.
8. Update/extend tests (PE-VARIANT/PE-THINKING, provider-level reasoning body, cross-engine same-type/cross-type).

**Rollback:** revert the config rename/wiring and the `CrossEngineContextInjector` guard; per-model config reverts to current (dead-`interleaved`) behavior; cross-engine transfers return to id-comparison.

## Open Questions

- None blocking. (Potential future: a `sessionFamily` marker if opencode/cursor/copilot session-sharing semantics diverge from type equality.)
