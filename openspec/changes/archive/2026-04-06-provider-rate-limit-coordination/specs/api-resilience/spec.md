## ADDED Requirements

### Requirement: Provider-level shared cooldown coordinates concurrent callers on 429
The system SHALL maintain a `cooldownUntil` timestamp (milliseconds since epoch, default `0`) on each `AIProvider` instance. When any retry wrapper (`retryStream` or `retryTurn`) catches a `ProviderError` with `status: 429` and a `retryAfter` value, it SHALL set `provider.cooldownUntil = Date.now() + retryAfter * 1000`. Before each API call attempt, the retry wrapper SHALL check `provider.cooldownUntil`; if `Date.now() < provider.cooldownUntil`, it SHALL sleep for the remaining duration before proceeding.

#### Scenario: First caller sets cooldown for subsequent callers
- **WHEN** caller A receives a 429 with `retryAfter: 30` and sets `provider.cooldownUntil`
- **THEN** caller B, about to make an API call on the same provider, waits approximately 30 seconds before its next attempt instead of immediately hitting the API

#### Scenario: No overhead when no 429 has occurred
- **WHEN** no 429 has been received and `provider.cooldownUntil` is `0`
- **THEN** the retry wrapper proceeds immediately with no sleep

#### Scenario: Cooldown naturally expires
- **WHEN** a cooldown was set 30 seconds ago with `retryAfter: 30`
- **THEN** `Date.now() >= provider.cooldownUntil` and the retry wrapper proceeds immediately

#### Scenario: Concurrent writers converge to a valid cooldown
- **WHEN** two callers receive 429 responses within the same window and both write `cooldownUntil`
- **THEN** the last writer's value is used, which is approximately correct since both `retryAfter` values refer to the same rate limit window

### Requirement: Background sources bail immediately on 429
The retry wrappers SHALL accept a `source` parameter of type `"foreground" | "background"` (default `"foreground"`). When a `"background"` source receives a `ProviderError` with `status: 429`, the wrapper SHALL set the provider's `cooldownUntil` timestamp (to benefit other callers) and then re-throw the error immediately without retrying. Foreground sources SHALL wait for cooldown and retry as normal.

#### Scenario: Compaction bails on 429
- **WHEN** a compaction call (source `"background"`) receives a 429 with `retryAfter: 60`
- **THEN** the wrapper sets `provider.cooldownUntil` and immediately re-throws the `ProviderError` without sleeping or retrying

#### Scenario: Main task execution retries on 429
- **WHEN** a main task execution call (source `"foreground"`) receives a 429 with `retryAfter: 60`
- **THEN** the wrapper sets `provider.cooldownUntil`, waits for the cooldown, and retries normally

#### Scenario: Background source does not retry other retryable statuses
- **WHEN** a background source receives a 429
- **THEN** it bails immediately; other retryable statuses (500, 502, 503, 504, 529) are still retried normally for background sources

## MODIFIED Requirements

### Requirement: Transient API errors are retried with exponential backoff
The system SHALL retry `ProviderError` with `status` in `[429, 529, 500, 502, 503, 504]` up to a configurable maximum. Backoff delay is `min(500ms × 2^attempt, 32000ms)`. If the error carries `retryAfter`, the delay SHALL be `max(computed exponential backoff, retryAfter × 1000ms)`. Uniform jitter in `[0, 1000ms]` SHALL be added after the `max` operation so that jitter is never absorbed by a large `retryAfter` value. Status 529 is limited to a separate maximum of 3 retries regardless of the global retry cap.

#### Scenario: 429 rate-limit retried with backoff
- **WHEN** the provider throws `ProviderError` with `status: 429` and no `retryAfter`
- **THEN** the wrapper waits the computed backoff duration and retries the call

#### Scenario: retry-after header respected
- **WHEN** the provider throws `ProviderError` with `status: 429` and `retryAfter: 60`
- **THEN** the wrapper waits at least 60 seconds before the next attempt

#### Scenario: Jitter spreads retries when retryAfter dominates
- **WHEN** the provider throws `ProviderError` with `retryAfter: 60` and the computed exponential backoff is 2 seconds
- **THEN** the delay is `max(2000, 60000) + jitter` (approximately 60000–61000ms), not a flat 60000ms for all callers

#### Scenario: 529 overloaded capped at 3 retries
- **WHEN** the provider throws `ProviderError` with `status: 529` on three consecutive attempts
- **THEN** no further retries are made and the error is re-thrown after the third attempt

#### Scenario: Non-retryable status propagates immediately
- **WHEN** the provider throws `ProviderError` with `status: 400`
- **THEN** the wrapper does not retry and re-throws immediately
