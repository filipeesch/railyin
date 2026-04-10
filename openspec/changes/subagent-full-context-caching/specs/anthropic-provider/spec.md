## ADDED Requirements

### Requirement: Anthropic provider sends server-side context edit strategy header
The system SHALL include the `anthropic-beta: context-editing-2025-10-01` header on every Anthropic API request when `anthropic.context_edit_strategy.enabled` is `true` in workspace config (default: `true`). The request body SHALL include a `context_edit_strategy` object that instructs the server to clear old tool results once input tokens exceed a threshold:
```json
{
  "type": "clear_tool_uses_20250919",
  "trigger": { "type": "input_tokens", "value": 80000 },
  "keep": { "type": "tool_uses", "value": 20000 },
  "clear_at_least": { "type": "input_tokens", "value": 20000 }
}
```

#### Scenario: Beta header and strategy sent when enabled
- **WHEN** `anthropic.context_edit_strategy.enabled` is `true` (or not set, defaulting to true)
- **THEN** the Anthropic request includes the `anthropic-beta: context-editing-2025-10-01` header and the `context_edit_strategy` body parameter

#### Scenario: Header and strategy omitted when disabled
- **WHEN** `anthropic.context_edit_strategy.enabled` is explicitly `false`
- **THEN** no `anthropic-beta` header is added and no `context_edit_strategy` is sent

#### Scenario: Unknown beta header is tolerated gracefully
- **WHEN** the Anthropic API does not recognize the beta header
- **THEN** the API call succeeds (Anthropic ignores unknown beta strings) and no error is thrown

### Requirement: Anthropic provider escalates max_tokens on truncation
The system SHALL automatically retry a `stream()` or `turn()` call that completes with `stop_reason: "max_tokens"` and an initial `max_tokens` ≤ 8192 by issuing a second request with `max_tokens: 64000`. The retry is transparent to the caller.

#### Scenario: Truncated call retried at 64K
- **WHEN** a call returns `stop_reason: "max_tokens"` with original `max_tokens` ≤ 8192
- **THEN** the same call is retried with `max_tokens: 64000` and the retry result is returned

#### Scenario: Already-escalated call not retried
- **WHEN** a call returns `stop_reason: "max_tokens"` with `max_tokens` already at 64000
- **THEN** no further retry is triggered

### Requirement: Anthropic provider emits cache break warnings when system or tools hash changes
The system SHALL compute a short hash of the stable system block and tool definitions before each API call. If either differs from the previous call within the same execution, it SHALL emit a WARN-level log identifying the changed component.

#### Scenario: Cache break detected and logged
- **WHEN** the system block hash or tools hash changes between consecutive rounds of the same execution
- **THEN** a WARN log is emitted: `[cache] <system|tools> hash changed: <old> → <new>`
