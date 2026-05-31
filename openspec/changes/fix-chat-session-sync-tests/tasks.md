## 1. Patch Test Schema (`helpers.ts`)

- [ ] 1.1 In `src/bun/test/helpers.ts`, add `ON DELETE CASCADE` to the `conversation_id` FK in the `conversation_messages` table definition inside `initDb()`
- [ ] 1.2 In `src/bun/test/helpers.ts`, add a FK `REFERENCES conversations(id) ON DELETE CASCADE` on `stream_events.conversation_id` inside `initDb()` (currently no FK exists)

## 2. Backend — Retention Job Tests (extend `retention-job.test.ts`)

- [ ] 2.1 Add suite RJ-5: seed an archived session with `archived_at` 8 days ago; verify `job.runNow()` deletes it (RJ-5a)
- [ ] 2.2 Add RJ-5b: seed an archived session with `archived_at` 3 days ago; verify it is preserved after `job.runNow()`
- [ ] 2.3 Add RJ-5c: seed an idle session with any age; verify it is never deleted
- [ ] 2.4 Add RJ-5d: seed `conversation_messages` linked to the doomed session; verify they are deleted after `job.runNow()` (cascade)
- [ ] 2.5 Add RJ-5e: seed `stream_events` linked to the doomed session; verify they are deleted after `job.runNow()` (cascade)

## 3. Backend — Migration Test (extend `db-migrations.test.ts`)

- [ ] 3.1 Add suite M-048: run full migration stack on a temp DB; assert it completes without error (M-048a)
- [ ] 3.2 Add M-048b: after migration, insert `conversations` + `conversation_messages` row, delete the conversation, assert message is cascade-deleted
- [ ] 3.3 Add M-048c: after migration, insert `conversations` + `stream_events` row, delete the conversation, assert stream_events row is cascade-deleted

## 4. Composable Unit Tests (new `useSessionSyncHandler.test.ts`)

- [ ] 4.1 Create `src/mainview/composables/useSessionSyncHandler.test.ts` with shared test setup: stub `onWsReconnect`, `loadSessions`, and a `ref<string|null>` as `watchKey` source
- [ ] 4.2 Add SS-1: verify `onWsReconnect` stub is called exactly once during composable setup
- [ ] 4.3 Add SS-2 and SS-3: fire reconnect callback once and twice; assert `loadSessions` call args
- [ ] 4.4 Add SS-4: reconnect with `watchKey` returning `null`; assert `loadSessions` called with `undefined`
- [ ] 4.5 Add SS-5 and SS-6: change reactive `ref` to non-null and null values; assert `loadSessions` call behavior after `nextTick()`
- [ ] 4.6 Add SS-7: assert `loadSessions` is called synchronously on setup (immediate watch)
- [ ] 4.7 Add SS-8: verify reconnect and key change each independently trigger `loadSessions`

## 5. Store Unit Tests (extend `src/mainview/stores/chat.test.ts`)

- [ ] 5.1 In `beforeEach`, also init `useWorkspaceStore()` from the same Pinia instance and set `activeWorkspaceKey` to a test value
- [ ] 5.2 Add C7a, C7b, C7c: call `chatStore.onChatSessionUpdated(session)` with matching, mismatched, and null workspace keys; assert `sessions` array contents
- [ ] 5.3 Add C8a: call `loadSessions` twice; assert `sessions.length` equals one response size
- [ ] 5.4 Add C8b: call `loadSessions("ws-2")`; assert API call received `{ workspaceKey: "ws-2" }`
- [ ] 5.5 Add C8c: call `loadSessions("ws-1")` then `loadSessions("ws-2")` with different responses; assert only ws-2 sessions remain

## 6. Playwright — Remove Dead Test

- [ ] 6.1 Delete test `CS-D-3` ("chatSession.created WS event adds new session to list") from `e2e/ui/chat-sidebar.spec.ts`

## 7. Playwright — Workspace Filter Suite (CS-H)

- [ ] 7.1 Add `describe("CS-H — Workspace filter on WS push")` to `e2e/ui/chat-sidebar.spec.ts`
- [ ] 7.2 Add CS-H-1: push `chatSession.updated` with wrong `workspaceKey`; assert session NOT in sidebar
- [ ] 7.3 Add CS-H-2: push `chatSession.updated` with correct `workspaceKey`; assert session appears in sidebar
- [ ] 7.4 Add CS-H-3: set up two workspace tabs; click second tab; assert `api.capture("chatSessions.list")` was called with new workspace key

## 8. Playwright — Count Badge Suite (CS-I)

- [ ] 8.1 Add `describe("CS-I — Toolbar count badge")` to `e2e/ui/chat-sidebar.spec.ts`
- [ ] 8.2 Add CS-I-1: `api.returns("chatSessions.list", [s1, s2])`; assert badge visible with text `"2"`
- [ ] 8.3 Add CS-I-2: `api.returns("chatSessions.list", [])`; assert badge not visible (or shows `0`)
- [ ] 8.4 Add CS-I-3: start with 1 session; push `chatSession.updated` with new session; assert badge increments to `2`
- [ ] 8.5 Add CS-I-4: 1 active + 1 archived session; assert badge shows `1`
