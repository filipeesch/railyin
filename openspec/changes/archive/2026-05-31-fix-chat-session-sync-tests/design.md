## Context

The `fix-chat-session-sync` change introduces a new composable (`useSessionSyncHandler`), store-level workspace filtering, a hard-delete retention job, and a cascade DB migration. None of these have tests. Each requires a different test tier: composable → pure TS unit; store logic → Pinia unit; retention job → backend unit with in-memory DB; migration → backend integration; UI behavior → Playwright.

The test schema in `src/bun/test/helpers.ts` currently lacks `ON DELETE CASCADE` on `conversation_messages` and no FK at all on `stream_events.conversation_id`. These gaps must be patched in the test helper to mirror production after migration 048 — without this the cascade backend tests would trivially fail.

Existing test infrastructure is healthy: `createMockWait()` for timer injection, `seedChatSession()` for DB seeding, `vi.mock('../rpc')` pattern for store isolation, and `ApiMock`/`WsMock` for Playwright.

## Goals / Non-Goals

**Goals:**
- Prove `useSessionSyncHandler` fires `loadSessions` on reconnect and workspace change
- Prove `onChatSessionUpdated` silently drops cross-workspace push events
- Prove `loadSessions` replaces (not appends) on repeated calls
- Prove the hard-delete job deletes archived sessions older than 7 days and cascades to child tables
- Prove migration 048 applies without error and cascades work on the real migration stack
- Prove the count badge reflects non-archived session count in the UI
- Prove the sidebar re-fetches sessions on workspace switch

**Non-Goals:**
- Testing session creation, archiving, rename, or messaging flows (covered elsewhere)
- E2E testing of the reconnect path in Playwright (WsMock has no reconnect simulation — composable unit tests cover this)
- Performance or load testing of the retention job

## Decisions

### 1. `useSessionSyncHandler` tests use `ref` + `watch` from Vue — no Pinia

The composable accepts a plain getter `() => string | null` for the workspace key, not a `Ref`. Tests can drive it with a `ref` and call `await nextTick()` after mutations to trigger the watcher. No store setup needed. This is the same pattern used by `useColumnTransitions.test.ts`.

### 2. Store tests (C7, C8) spin up a real Pinia with both `chat` and `workspace` stores

`onChatSessionUpdated` reads `workspaceStore.activeWorkspaceKey` internally. Tests set `workspaceStore.activeWorkspaceKey` directly (Pinia state is writable in tests) then fire `chatStore.onChatSessionUpdated(session)`. The `vi.mock('../rpc')` pattern isolates the API transport.

### 3. Retention job cascade tests seed real rows and assert on counts after `runNow()`

`seedChatSession()` already exists. Tests insert `conversation_messages` and `stream_events` rows linked to the session's `conversation_id`, run `job.runNow()`, then query counts. This proves cascade without mocking the delete logic.

### 4. `helpers.ts` schema patch is part of this change — not the migration change

The migration change (`fix-chat-session-sync`) owns the production migration file. This test change owns the corresponding test schema update in `helpers.ts`. They must be merged together so backend tests pass end-to-end.

### 5. Playwright CS-D-3 deletion — not a refactor, a cleanup

CS-D-3 tests `chatSession.created` WS push adding a session to the list. Since the backend never emitted this event and the code is being deleted, the test is testing dead code. Deleting it (rather than updating it) is correct — there is no new equivalent behavior to test at the Playwright layer for creation (creation still goes through `chatSessions.create` RPC + `chatSession.updated` push, covered by CS-B-1).

## Risks / Trade-offs

- **[Risk] `helpers.ts` schema diverges from real migrations** → Mitigated by the M-048 migration test in `db-migrations.test.ts` which tests the real migration on a real DB. If helpers drift again, M-048 will catch it.
- **[Risk] `watch` with `immediate: true` in `useSessionSyncHandler` fires synchronously in tests** → Vue's `watch` with `immediate` is synchronous on first call. Tests don't need `await nextTick()` for the initial load assertion, but do need it for reactive change assertions. This is well-understood behavior.
- **[Trade-off] No Playwright test for reconnect** → Accepted. The composable unit tests (SS-1 to SS-8) provide correctness guarantees. Adding `WsMock.reconnect()` is a separate infrastructure improvement that doesn't block this change.
