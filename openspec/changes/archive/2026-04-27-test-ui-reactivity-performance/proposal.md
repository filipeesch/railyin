## Why

`fix-ui-reactivity-performance` removes the `streamVersion` bomb and cleans up Pinia store boundaries, but no test suite exists that would catch regressions in stream state handling, rendering isolation, or store scope. This change adds the full three-layer test suite (unit, multi-store, Playwright) needed to guard these behaviors permanently.

## What Changes

- Add stream block state unit tests to `src/mainview/stores/conversation.test.ts` (suite SB — 10 cases)
- Add new `src/mainview/stores/task.test.ts` with store behavior and O(1) lookup tests (suite T — 8 cases)
- Add new `src/mainview/stores/chat.test.ts` with unread Set and passthrough removal tests (suite C — 6 cases)
- Add new `src/mainview/stores/dispatch.test.ts` for multi-store event dispatch ordering (suite D — 5 cases)
- Add new `e2e/ui/stream-reactivity.spec.ts` Playwright spec with 5 suites (A–E) covering live streaming DOM behavior, rendering isolation, memory cleanup, unread state, and auto-scroll

## Capabilities

### New Capabilities

- `ui-stream-reactivity-tests`: Test contracts for reactive stream state behavior — Map identity preservation, per-key Vue tracking, block cleanup on done, MutationObserver-verified rendering isolation.
- `ui-store-boundary-tests`: Test contracts for Pinia store scope — no passthrough leakage, O(1) task lookup, reactive Set mutations.

### Modified Capabilities

*(No existing spec-level behavior changes — this change only adds tests.)*

## Impact

- `src/mainview/stores/conversation.test.ts` — extended with SB-1…SB-10 stream block suite
- `src/mainview/stores/task.test.ts` — new file
- `src/mainview/stores/chat.test.ts` — new file
- `src/mainview/stores/dispatch.test.ts` — new file
- `e2e/ui/stream-reactivity.spec.ts` — new file
- No production code changes. No backend changes. No API contract changes.
