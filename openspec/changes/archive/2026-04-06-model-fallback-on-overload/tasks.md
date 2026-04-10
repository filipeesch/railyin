## 1. Config Schema

- [x] 1.1 Add optional `fallback_model` field (string, fully-qualified model ID) to provider config schema in `src/bun/config/index.ts`
- [x] 1.2 Add `fallback_model` example to `config/workspace.yaml.sample`

## 2. Retry Wrapper Changes

- [x] 2.1 Add `fallbackProvider?: AIProvider | null` parameter to `retryStream` signature (default `null`)
- [x] 2.2 In `retryStream`, after 529 exhaustion and before throwing, attempt a single `fallbackProvider.stream()` call if non-null; yield its events on success, throw original error on failure
- [x] 2.3 Add `fallbackProvider?: AIProvider | null` parameter to `retryTurn` signature (default `null`)
- [x] 2.4 In `retryTurn`, after 529 exhaustion and before throwing, attempt a single `fallbackProvider.turn()` call if non-null; return its result on success, throw original error on failure
- [x] 2.5 Log a warning when a fallback attempt is made, including the fallback model name

## 3. Engine Integration

- [x] 3.1 In `runExecution`, resolve `fallbackProvider` from the active provider's config `fallback_model` field using `resolveProvider`; catch resolution errors and default to `null`
- [x] 3.2 Pass `fallbackProvider` to `retryStream` calls in the execution loop
- [x] 3.3 In `runSubExecution`, resolve and pass `fallbackProvider` to `retryTurn` calls

## 4. Tests

- [x] 4.1 Write a test verifying `retryTurn` attempts the fallback provider after 3 consecutive 529s
- [x] 4.2 Write a test verifying the original error is thrown if the fallback also fails
- [x] 4.3 Write a test verifying no fallback is attempted when `fallbackProvider` is null
- [x] 4.4 Write a test verifying fallback on `retryStream` yields events from the fallback provider
