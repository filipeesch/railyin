## ADDED Requirements

### Requirement: Per-model config resolved to canonical SDK thinking level
The Pi engine SHALL resolve the selected Mode variant's `reasoningEffort` to a canonical pi SDK thinking level (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`) and set `session.agent.state.thinkingLevel` to that canonical level. The mapping SHALL be: `"none"` → `"off"`, any already-valid canonical level passed through unchanged, and any other value falling back to `"off"`. The variant's `label`/`name` and the Mode axis option id SHALL NOT be written into `thinkingLevel`.

#### Scenario: Mode variant with a canonical reasoningEffort
- **WHEN** a conversation selects the `max` Mode variant whose `options.reasoningEffort` is `"xhigh"` on a reasoning-capable Pi model
- **THEN** `session.agent.state.thinkingLevel` is set to `"xhigh"` (a valid SDK level, not clamped)
- **AND** the SDK emits exactly one reasoning field per its `compat.thinkingFormat`

#### Scenario: Mode variant with "none" reasoningEffort maps to off
- **WHEN** a conversation selects the `none` Mode variant whose `options.reasoningEffort` is `"none"`
- **THEN** `session.agent.state.thinkingLevel` is set to `"off"`

#### Scenario: Non-standard reasoningEffort value falls back to off
- **WHEN** a Mode variant's `options.reasoningEffort` is a value that is not a valid canonical SDK level and not `"none"`
- **THEN** `session.agent.state.thinkingLevel` is set to `"off"`

### Requirement: SDK owns the effort knob; provider-specific reasoning knobs stay flexible
The Pi engine SHALL map the variant's `reasoningEffort`/`reasoning_effort` to a canonical SDK level via `session.agent.state.thinkingLevel`, and SHALL NOT forward `reasoning_effort`/`reasoningEffort` through `session.agent.onPayload` — that key is owned by the SDK, driven by `thinkingLevel` through `compat.thinkingFormat`. This is what prevents the DeepSeek/OpenRouter clash (SDK `reasoning:{effort}` vs a Railyin `reasoning_effort`).

Provider-specific reasoning knobs that are NOT the effort knob (`enable_thinking`, `thinking`, `chat_template_kwargs`) MAY be forwarded through `onPayload` for per-model flexibility — different models need different reasoning args, so the union of static `options`, Mode-variant options, custom-axis runtime values, and sampling preset fields MAY include these keys. The engine SHALL NOT auto-inject them; it only passes through what the config declares.

#### Scenario: Reasoning modes produce no conflicting effort keys
- **WHEN** a DeepSeek model served via OpenRouter runs a Mode variant with `options.reasoningEffort: "xhigh"`
- **THEN** `session.agent.state.thinkingLevel` is `"xhigh"`
- **AND** `session.agent.onPayload` does NOT contain a `reasoning_effort` or `reasoningEffort` key (the SDK emits the single `reasoning:{effort:...}` field per its thinkingFormat)

#### Scenario: onPayload retains non-reasoning params
- **WHEN** a Mode variant sets `options.temperature` and a preset sets `top_p`
- **THEN** `session.agent.onPayload` merges `temperature` and `top_p` into the request body and carries no `reasoning_effort`/`reasoningEffort` key

#### Scenario: provider-specific reasoning knob is forwarded when declared
- **WHEN** a Mode variant declares `options.chat_template_kwargs: { enable_thinking: true }` (a provider-specific reasoning knob, not the effort key)
- **THEN** `session.agent.onPayload` passes the declared `chat_template_kwargs` through to the request body
- **AND** `session.agent.state.thinkingLevel` is still set to the canonical level derived from the variant (reasoning-enabled when no explicit effort)

#### Scenario: provider-specific reasoning knob is NOT auto-injected
- **WHEN** a variant does not declare `enable_thinking`/`thinking`/`chat_template_kwargs`
- **THEN** `session.agent.onPayload` does not add any of those keys (the engine only passes through what config declares)
