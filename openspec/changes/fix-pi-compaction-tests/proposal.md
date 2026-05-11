## Why

The `fix-pi-compaction` feature introduces compaction fixes across four layers (Pi engine, stream processor, orchestrator, frontend store). These changes have zero automated test coverage today. This proposal adds the full test suite so all new behaviour is verified and regressions are caught automatically.

## What Changes

- **New test file** `src/bun/test/pi-engine.test.ts` — unit tests for `PiEngine.compact()`: session restoration, `isCompacting` guard, post-compact DB write, error propagation.
- **Extended** `src/bun/test/stream-processor.test.ts` — tests for `compaction_done` content bug fix (summary stored vs. empty string).
- **Extended** `src/bun/test/orchestrator.test.ts` — tests for `compactTask()` broadcasting `message.new` after compact, engine-without-compact error, propagation of engine errors.
- **Extended** `src/mainview/stores/conversation.test.ts` — tests for `fetchContextUsage()` being triggered when `onNewMessage` receives a `compaction_summary` message.
- **Extended** `e2e/ui/extended-chat.spec.ts` — two new Playwright tests in Suite R: gauge drops immediately after compact (R-24 revision), and already-compacting error is visible (R-25).
- **Refactoring** `src/bun/engine/pi/engine.ts` — `getOrCreateSession` visibility changed from `private` to `protected` to enable test subclassing without alternative paths or conditional test logic.

## Capabilities

### New Capabilities

- `pi-compaction-unit-tests`: Unit and integration tests covering the compaction fixes: stream-processor compaction_done content, Pi engine compact() lifecycle, orchestrator post-compact broadcast, and frontend gauge refresh on compaction_summary.

### Modified Capabilities

- `pi-playwright-tests`: Add E2E tests R-24 (gauge drops after compact) and R-25 (already-compacting error visible) to `e2e/ui/extended-chat.spec.ts` Suite R.

## Impact

- `src/bun/test/pi-engine.test.ts` — new file
- `src/bun/test/stream-processor.test.ts` — new `describe` block
- `src/bun/test/orchestrator.test.ts` — new `describe` block
- `src/mainview/stores/conversation.test.ts` — 2 new tests in `conversationStore` describe block
- `e2e/ui/extended-chat.spec.ts` — 2 new tests appended to Suite R
- `src/bun/engine/pi/engine.ts` — 1 visibility change (`private` → `protected`) to enable test subclassing; no runtime behaviour change
