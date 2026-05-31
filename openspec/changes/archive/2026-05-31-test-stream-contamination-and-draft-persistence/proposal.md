## Why

The `fix-stream-contamination-and-draft-persistence` change introduces meaningful behavior fixes and new store logic but has zero test coverage for any of the new paths. Without tests, regressions in stream isolation and draft persistence will be invisible.

## What Changes

- **New unit tests** in `conversation.test.ts`: update SB-5 and SB-9 to assert the non-active `streamStates` entry is deleted (not retained), and add SB-NEW-3 as a memory-leak regression guard.
- **New unit tests** in `task.test.ts`: three tests (T-SC-1, T-SC-2, T-SC-3) verifying that `sendMessage` and `drainQueue` for a background task do not mutate `activeConversationId` or append messages to the active conversation.
- **New unit test file** `src/mainview/stores/draft.test.ts`: six tests covering the full `draftStore` lifecycle — `get`/`set`/`clear`, TTL eviction, and key isolation between tasks and sessions.
- **Extended Playwright spec** `e2e/ui/conversation-stream-state.spec.ts`: add SS-3, which simulates queue drain for a background task while the user is viewing a different task and asserts no contamination.
- **New Playwright spec** `e2e/ui/conversation-draft.spec.ts`: six end-to-end tests covering draft persistence across tab switches, drawer close/reopen, page reload, send-clears-draft, and cross-task draft isolation.

## Capabilities

### New Capabilities

- `stream-contamination-coverage`: Unit and E2E tests verifying that background task queue drains and stream events never contaminate the active conversation view.
- `draft-persistence-coverage`: Unit and E2E tests verifying draft store lifecycle — persisted on change, restored on mount, cleared on send, evicted after 7 days, isolated per task and session.

### Modified Capabilities

- `frontend-reactive-stream`: Existing SB-5 and SB-9 test assertions are inverted — the correct post-fix behavior is that the non-active entry is absent from `streamStates`, not present as a cleared shell.

## Impact

- `src/mainview/stores/conversation.test.ts` — SB-5 and SB-9 updated; SB-NEW-3 added
- `src/mainview/stores/task.test.ts` — T-SC-1, T-SC-2, T-SC-3 added
- `src/mainview/stores/draft.test.ts` — new file
- `e2e/ui/conversation-stream-state.spec.ts` — SS-3 added
- `e2e/ui/conversation-draft.spec.ts` — new file
- No production code changes; no backend, API, or schema changes
