## MODIFIED Requirements

### Requirement: 529 retry exhaustion triggers fallback model attempt
The retry wrappers (`retryStream` and `retryTurn`) SHALL accept an optional `fallbackProvider` parameter (`AIProvider | null`). When 529 retries are exhausted (3 consecutive 529 errors) and a `fallbackProvider` is supplied, the wrapper SHALL attempt a single call using `fallbackProvider` instead of immediately throwing. If the fallback call succeeds, its result is returned normally. If the fallback call fails, the original 529 error is thrown.

#### Scenario: Fallback attempted after 3 consecutive 529s
- **WHEN** `retryStream` encounters 3 consecutive 529 errors and `fallbackProvider` is non-null
- **THEN** a single `fallbackProvider.stream()` call is attempted with the same messages and options

#### Scenario: Fallback succeeds
- **WHEN** the fallback provider's call returns successfully
- **THEN** the response is yielded normally and a warning is logged noting the fallback model was used

#### Scenario: Fallback fails
- **WHEN** the fallback provider's call also throws an error
- **THEN** the original 529 error is re-thrown as if no fallback was configured

#### Scenario: No fallback configured
- **WHEN** `fallbackProvider` is null (default)
- **THEN** behavior is identical to today — 529 exhaustion throws the error immediately

#### Scenario: Fallback logged transparently
- **WHEN** a fallback call is attempted
- **THEN** a warning log entry records "Falling back to <fallback model> after 529 exhaustion"
