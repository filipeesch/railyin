## Why

The `fix-chat-session-sync` change introduces new behavior (workspace filter, reconnect re-sync, composable, retention job, cascade migration) with no corresponding test coverage. This change adds the full test suite to prove each behavior in isolation and as an integrated system.

## What Changes

- **New**: `useSessionSyncHandler.test.ts` — unit tests for the new composable (SS-1 to SS-8)
- **New**: Backend suite RJ-5 in `retention-job.test.ts` — hard-delete job tests with cascade verification
- **New**: Migration suite M-048 in `db-migrations.test.ts` — verifies `ON DELETE CASCADE` is applied correctly
- **Extended**: `chat.test.ts` — store unit tests C7 (WS push workspace filter) and C8 (loadSessions idempotency/key switching)
- **Extended**: `chat-sidebar.spec.ts` — Playwright suites CS-H (workspace filter), CS-I (count badge)
- **Removed**: `chat-sidebar.spec.ts` CS-D-3 — tests dead `chatSession.created` behavior being deleted in the main change
- **Updated**: `src/bun/test/helpers.ts` — add `ON DELETE CASCADE` to `conversation_messages` and `stream_events` test schema to mirror production after migration 048

## Capabilities

### New Capabilities

- `chat-session-sync-tests`: Full test coverage for session sync correctness (composable unit, store unit, Playwright integration)
- `chat-session-retention-tests`: Backend unit tests for the hard-delete retention job and cascade migration

### Modified Capabilities

_(none — this change adds tests only, no behavior changes)_

## Impact

- `src/mainview/composables/useSessionSyncHandler.test.ts` — new file
- `src/mainview/stores/chat.test.ts` — extended with C7, C8
- `src/bun/test/retention-job.test.ts` — extended with RJ-5
- `src/bun/test/db-migrations.test.ts` — extended with M-048
- `src/bun/test/helpers.ts` — schema updated for cascade constraints
- `e2e/ui/chat-sidebar.spec.ts` — CS-H and CS-I suites added; CS-D-3 deleted
