## Why

Every API call re-sends the full system prompt, tool definitions, and board context at full input token cost. For Anthropic models, prompt caching reduces cache-read token cost to ~10% of full input cost. Since our system prompt is large and stable across tool-loop rounds within a single task execution, every round after the first is a perfect candidate for cache hits — this is pure cost reduction at no quality trade-off.

## What Changes

- **`cache_control` markers on Anthropic system blocks**: The last system message block sent to Anthropic's API will carry `cache_control: { type: "ephemeral" }`, instructing the API to cache everything up to and including that block.
- **`cache_control` on conversation history breakpoint**: In multi-turn conversations, a second cache breakpoint will be placed on the last `user` message before the current turn (approx. the 5th-from-last user message), enabling cross-call conversation context reuse.
- **Anthropic-only**: No change to `OpenAICompatibleProvider` — the `cache_control` field is silently ignored by any provider that doesn't support it, but it's gated in `adaptMessages()` to avoid accidental confusion.
- **Wire format change**: `adaptMessages()` in `anthropic.ts` returns system messages as structured content blocks (array form `[{ type: "text", text: "...", cache_control: {...} }]`) instead of a plain string when caching is enabled, matching the Anthropic messages API contract.

## Capabilities

### New Capabilities
- `prompt-caching`: Anthropic prompt caching strategy — which content blocks are marked, breakpoint placement policy, provider contract for cache_control markers.

### Modified Capabilities
- `ai-provider`: `adaptMessages()` for Anthropic now returns system content as a block array when caching is enabled; the `AIProvider` interface is unchanged but implementations may enrich wire payloads with provider-specific caching hints.

## Impact

- `src/bun/ai/anthropic.ts` — `adaptMessages()` and `headers()` modified; `ANTHROPIC_BETA_THINKING` header already present (no new beta header required for basic caching)
- `src/bun/ai/types.ts` — no interface changes needed; caching is wire-level only
- No engine or frontend changes
- Validation: once T4 (usage-token-tracking) is implemented, `cache_read_input_tokens > 0` in the usage event confirms caching is active
