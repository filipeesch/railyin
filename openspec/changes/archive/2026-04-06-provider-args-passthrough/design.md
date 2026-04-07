## Context

`OpenAICompatibleProvider` sends a hardcoded request body with no way for users to pass provider-specific routing fields. OpenRouter exposes a `provider` object in the request body that controls routing (which backends to use, ordering, fallback behaviour, etc.). Without the ability to set this, OpenRouter's default load-balancing routes Claude models to Azure/Vertex backends that reject certain request formats, causing 400 errors.

The fix is a transparent passthrough: `ProviderConfig` gains an optional `provider_args` field whose contents are forwarded verbatim as the `provider` key in every request body. No provider-specific logic is needed in code — configuration drives the behaviour entirely.

## Goals / Non-Goals

**Goals:**
- Allow any `workspace.yaml` provider entry to specify arbitrary extra fields to include in the request body
- Fix the OpenRouter/Azure 400 error for Claude models with zero extra code logic
- Keep `OpenAICompatibleProvider` generic — no OpenRouter-specific branching

**Non-Goals:**
- Per-model or per-request `provider_args` overrides (single value per provider entry)
- Validation of `provider_args` contents (passed through opaquely)
- Support for `AnthropicProvider` (it has its own wire format and this field doesn't apply)

## Decisions

### Decision: `provider_args` as a flat passthrough object, not a typed schema

**Chosen**: `provider_args?: Record<string, unknown>` — opaque object merged into request body as-is.

**Alternatives considered**:
- Typed per-provider schemas (e.g. `openrouter_provider_preferences`): Too rigid, requires schema updates whenever OpenRouter adds new fields.
- Per-model glob matching (e.g. `anthropic/*: { ignore: [...] }`): More powerful but adds parsing complexity for a marginal gain.

**Rationale**: The passthrough approach is the minimum surface area. OpenRouter's `provider` fields are well-documented and stable. Users can add any current or future field without a code change.

### Decision: Merge under `provider` key, not at top level

The `provider` key is OpenRouter's documented namespace for routing preferences. Merging `provider_args` as `body.provider = config.provider_args` keeps the request body semantically correct and avoids collisions with standard fields like `model`, `messages`, `stream`.

### Decision: No `provider_args` support in `AnthropicProvider`

`AnthropicProvider` uses the Anthropic native format (`/v1/messages`), not OpenAI-compat. The `provider` field has no meaning there. Adding it would be misleading and could cause Anthropic to return 400.

## Risks / Trade-offs

- **Invalid `provider_args` silently forwarded**: If a user sets malformed values, the upstream API may return a 400. The error will surface in the conversation like any other provider error — not silent, but not descriptive either. Acceptable given the power-user nature of this field.
- **Cache invalidation**: `OpenAICompatibleProvider` instances are cached in `_registry` keyed by qualified model. If `provider_args` changes in `workspace.yaml`, the user must restart the app to pick up the change. This is consistent with existing behaviour for all config changes. → No mitigation needed.
