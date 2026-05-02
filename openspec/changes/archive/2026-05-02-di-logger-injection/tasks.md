## 1. Logger Interface

- [ ] 1.1 Add `Logger` interface, `noopLogger`, and `realLogger` exports to `src/bun/logger.ts`

## 2. AnthropicProvider DI

- [ ] 2.1 Add optional `logger?: Logger` as 8th constructor param in `AnthropicProvider`; replace all bare `log(…)` calls with `this.logger.log(…)`

## 3. retry.ts DI

- [ ] 3.1 Add `logger?: Logger` to `_RetryTimingConfig` in `src/bun/ai/retry.ts`; resolve `const logger = _tc.logger ?? realLogger` at start of `retryStream` and `retryTurn`; replace all bare `log(…)` calls with `logger.log(…)`

## 4. context.ts DI

- [ ] 4.1 Replace `opts.quiet` with `opts.logger?: Logger` in `compactMessages`; update 2 internal callers (`{ quiet: true }` → `{ logger: noopLogger }`)

## 5. session-memory.ts DI

- [ ] 5.1 Add optional `logger?: Logger` param to `extractAndWriteSessionMemory`; replace bare `log(…)` calls with `logger.log(…)`

## 6. Test Updates

- [ ] 6.1 Update `providers.test.ts` — pass `noopLogger` as 8th arg to `new AnthropicProvider(…)` in all test constructors
- [ ] 6.2 Update `retry.test.ts` — add `logger: noopLogger` to all `_tc` objects passed to `retryStream` and `retryTurn`

## 7. Verification

- [ ] 7.1 Run `bun test src/bun/test --timeout 20000` and confirm all tests pass
- [ ] 7.2 Run Stryker dry-run: `npx stryker run stryker.backend.json --mutate "src/bun/ai/anthropic.ts"` and confirm the initial test run passes without `no such table: logs`
