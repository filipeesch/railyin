## 1. Extend logger.ts

- [x] 1.1 Add `Logger` interface, `noopLogger`, and `realLogger` exports to `src/bun/logger.ts`

## 2. Inject Logger into AnthropicProvider

- [x] 2.1 Add optional `logger?: Logger` as last constructor parameter to `AnthropicProvider` in `src/bun/ai/anthropic.ts`, defaulting to `realLogger`
- [x] 2.2 Replace all `log(...)` calls inside `AnthropicProvider` with `this.logger.log(...)`

## 3. Inject Logger into retry.ts

- [x] 3.1 Add `logger?: Logger` field to `_RetryTimingConfig` in `src/bun/ai/retry.ts`
- [x] 3.2 Resolve `const logger = _tc.logger ?? realLogger` at the top of `retryStream`, `_retryStreamFallback`, and `retryTurn`; replace all `log(...)` calls with `logger.log(...)`

## 4. Refactor compactMessages in context.ts

- [x] 4.1 Remove `quiet?: boolean` from `compactMessages` opts and replace with `logger?: Logger` in `src/bun/conversation/context.ts`
- [x] 4.2 Update the two internal call sites in `context.ts` from `{ quiet: true }` to `{ logger: noopLogger }`

## 5. Inject Logger into session-memory.ts

- [x] 5.1 Add optional `logger?: Logger` parameter to the internal `extractAndWriteSessionMemory` function in `src/bun/workflow/session-memory.ts`; replace `log(...)` calls with `logger.log(...)`

## 6. Update tests

- [x] 6.1 Pass `noopLogger` as the last argument to `new AnthropicProvider(...)` in `src/bun/test/providers.test.ts`
- [x] 6.2 Add `logger: noopLogger` to `_tc` objects in `src/bun/test/retry.test.ts` where log-triggering paths (stall/retry/429) are exercised

## 7. Verify

- [x] 7.1 Run `bun test src/bun/test --timeout 20000` and confirm all tests pass
- [x] 7.2 Run Stryker dry-run smoke: `npx stryker run stryker.backend.json --mutate "src/bun/ai/anthropic.ts"` and confirm dry-run completes without `no such table: logs`
