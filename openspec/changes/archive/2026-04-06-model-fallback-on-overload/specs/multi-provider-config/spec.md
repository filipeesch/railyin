## ADDED Requirements

### Requirement: Provider config supports an optional fallback model
The system SHALL allow each provider config entry to declare an optional `fallback_model` field containing a fully-qualified model ID (e.g., `"anthropic/claude-sonnet-4-20250514"`). When present, the engine resolves the fallback model's provider and passes it to retry wrappers for use during 529 exhaustion. When absent, no fallback behavior is enabled.

#### Scenario: Fallback model configured
- **WHEN** a provider config contains `fallback_model: "anthropic/claude-sonnet-4-20250514"`
- **THEN** the engine resolves the fallback provider and passes it to `retryStream`/`retryTurn`

#### Scenario: No fallback model configured
- **WHEN** a provider config omits `fallback_model`
- **THEN** the `fallbackProvider` parameter passed to retry wrappers is `null`

#### Scenario: Invalid fallback model ignored gracefully
- **WHEN** `fallback_model` references an unconfigured provider (e.g., `"openai/gpt-4o"` but no `openai` provider is configured)
- **THEN** the fallback is treated as `null` with a warning log; the primary retry behavior proceeds normally
