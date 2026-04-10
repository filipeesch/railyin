## ADDED Requirements

### Requirement: Anthropic provider sends system content as structured blocks with cache hints
The system SHALL send the Anthropic `system` field as a `ContentBlock[]` array rather than a plain string when prompt caching is enabled. Each block contains `{ type: "text", text: string, cache_control?: { type: "ephemeral" } }`. The last block always carries the cache breakpoint marker.

#### Scenario: System content block array accepted by Anthropic API
- **WHEN** `adaptMessages()` is called for an Anthropic API call with system messages present
- **THEN** the request body contains `system: [{ type: "text", text: "...", cache_control: { type: "ephemeral" } }]` as an array rather than `system: "..."`

#### Scenario: Anthropic non-streaming turn also sends system block array
- **WHEN** `provider.turn()` is called for a compaction or sub-agent call using AnthropicProvider
- **THEN** the same block array form is used for the `system` field, consistent with streaming calls
