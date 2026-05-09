## MODIFIED Requirements

### Requirement: Available models are fetched dynamically from the provider
The system SHALL expose a `models.list` RPC that delegates to the active engine's `listModels()` method. For the Pi engine, this calls `GET {base_url}/v1/models` on each configured provider. For the Copilot engine, this returns models available through the Copilot subscription. For the Claude engine, this returns models available through the Claude Agent SDK in the same provider-grouped shape used by the rest of the product, with a single Claude provider group.

Each model entry in `ProviderModelList.models` SHALL include a `contextWindowEditable?: boolean` field. This field SHALL be `true` only when the engine signals that context window is user-configurable for this model (Pi and OpenCode engines). Copilot and Claude model entries SHALL NOT include this field (or it SHALL be `false`/absent).

The `contextWindow` value returned for each model SHALL reflect the following precedence: user override from `model_settings` DB → server-reported value from `/v1/models` → engine default (128,000 for Pi). The raw server-reported value is not exposed separately.

#### Scenario: Models returned grouped by provider with enabled flags
- **WHEN** all configured providers respond with valid model lists
- **THEN** `models.list` returns `ProviderModelList[]` — one entry per provider — each containing the provider `id`, a `models` array of `{ id: string, contextWindow: number | null, enabled: boolean }`, and no `error` field

#### Scenario: Failed provider included with error, not omitted
- **WHEN** one provider's `/v1/models` request fails and another succeeds
- **THEN** `models.list` returns one entry per provider: the failed provider has `error` set and an empty `models` array; the successful provider has its full model list

#### Scenario: Pi model contextWindow reflects DB override
- **WHEN** a user override exists in `model_settings` for a Pi model
- **THEN** `models.list` returns `contextWindow` equal to the override value, not the server-reported value

#### Scenario: Pi model contextWindow falls back to engine default when no override
- **WHEN** no override exists and the server does not report a context length
- **THEN** `models.list` returns `contextWindow: 128000` for that model

#### Scenario: Pi model rows have contextWindowEditable true
- **WHEN** `models.list` is called and Pi engine models are returned
- **THEN** each Pi model entry has `contextWindowEditable: true`

#### Scenario: Copilot model rows do not have contextWindowEditable
- **WHEN** `models.list` is called and Copilot engine models are returned
- **THEN** Copilot model entries have `contextWindowEditable` absent or `false`
