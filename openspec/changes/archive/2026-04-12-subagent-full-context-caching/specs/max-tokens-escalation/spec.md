## ADDED Requirements

### Requirement: Output token limit escalation on truncation
The system SHALL, when a `stream()` or `turn()` call to the Anthropic provider completes with `stop_reason: "max_tokens"`, automatically retry the same request with `max_tokens` escalated to `64000`. The retry SHALL use the identical message array and parameters as the original call. No external caller intervention is required.

#### Scenario: Truncated sub-agent call is retried at elevated limit
- **WHEN** an Anthropic API call returns `stop_reason: "max_tokens"` with `max_tokens` set to the initial value (≤ 8192)
- **THEN** the provider retries the call once with `max_tokens: 64000`
- **AND** the retry result is returned to the caller as if it were the original response

#### Scenario: Already-escalated call is not retried again
- **WHEN** an Anthropic API call returns `stop_reason: "max_tokens"` and `max_tokens` is already ≥ 64000
- **THEN** no further retry is attempted and the truncated result is returned

#### Scenario: Non-truncation stop reasons are not escalated
- **WHEN** an Anthropic API call returns `stop_reason: "end_turn"` or `stop_reason: "tool_use"`
- **THEN** no escalation retry occurs

#### Scenario: Escalation is logged
- **WHEN** an escalation retry is triggered
- **THEN** a log line is emitted: `[anthropic] max_tokens hit at <N>, retrying with 64000`
