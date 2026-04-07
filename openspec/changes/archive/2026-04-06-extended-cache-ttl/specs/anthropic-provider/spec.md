## MODIFIED Requirements

### Requirement: Anthropic provider supports configurable cache TTL
The system SHALL support an optional `ttl` field in `cache_control` blocks sent to the Anthropic API. When the workspace config sets `anthropic.cache_ttl` to `"1h"`, all `cache_control` blocks SHALL include `ttl: "1h"`. When set to `"5m"` or omitted, no `ttl` field is included (Anthropic defaults to 5 minutes).

#### Scenario: Default 5-minute TTL (no config or explicit "5m")
- **WHEN** `anthropic.cache_ttl` is absent or `"5m"` in workspace config
- **THEN** `cache_control` blocks are `{ type: "ephemeral" }` with no `ttl` field

#### Scenario: Extended 1-hour TTL
- **WHEN** `anthropic.cache_ttl` is `"1h"` in workspace config
- **THEN** `cache_control` blocks are `{ type: "ephemeral", ttl: "1h" }`

#### Scenario: Non-Anthropic providers unaffected
- **WHEN** the active provider is not Anthropic
- **THEN** no `cache_control` field is included in any request body
