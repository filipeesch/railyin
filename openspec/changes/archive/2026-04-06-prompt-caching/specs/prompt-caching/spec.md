## Purpose
Prompt caching reduces API costs for Anthropic models by reusing previously processed tokens. The system marks stable, large content blocks with cache control hints, enabling Anthropic to cache those tokens and charge reduced rates on subsequent cache hits.

## Requirements

### Requirement: System prompt cache breakpoint applied to Anthropic API calls
The system SHALL mark the last system content block with `cache_control: { type: "ephemeral" }` on every Anthropic API call. This applies to both streaming (`stream()`) and non-streaming (`turn()`) calls.

#### Scenario: System prompt is cached on repeated tool-loop rounds
- **WHEN** an Anthropic execution runs multiple tool-loop rounds with the same task context and stage instructions
- **THEN** each API call from round 2 onwards sends `cache_control: { type: "ephemeral" }` on the last system block, yielding `cache_read_input_tokens > 0` in the usage response

#### Scenario: System content sent as block array when caching is active
- **WHEN** `adaptMessages()` processes messages for an Anthropic API call
- **THEN** the `system` field in the request body is a `ContentBlock[]` array (not a plain string), with the last block carrying `cache_control: { type: "ephemeral" }`

#### Scenario: Single-system-block request still uses block array form
- **WHEN** the assembled messages contain only one system role message
- **THEN** `adaptMessages()` still returns a single-element block array with `cache_control` on that block

### Requirement: Conversation history cache breakpoint applied for long contexts
The system SHALL place a second cache breakpoint on a stable user message in the conversation history when the history has more than 4 messages. The breakpoint is placed on the user message at `messages.length - 5` (or the earliest available), allowing prior conversation context to be served from cache.

#### Scenario: Long conversation uses history cache breakpoint
- **WHEN** the adapted messages array has 6 or more entries
- **THEN** the user message at index `messages.length - 5` carries `cache_control: { type: "ephemeral" }` (in block array form if not already structured)

#### Scenario: Short conversation uses only the system breakpoint
- **WHEN** the adapted messages array has fewer than 5 entries
- **THEN** only the system block carries `cache_control`; no conversation breakpoint is added

### Requirement: Caching applies only to Anthropic provider; OpenAI-compatible providers are unmodified
The system SHALL NOT add `cache_control` to messages sent to OpenAI-compatible providers. The caching logic is contained entirely within `AnthropicProvider`'s `adaptMessages()`.

#### Scenario: OpenAI-compatible request has no cache_control fields
- **WHEN** the same task runs with an OpenAI-compatible provider
- **THEN** the outgoing request body contains no `cache_control` fields at any level
