## 1. ConversationMessageStore foundation

- [x] 1.1 Define the `ConversationMessageStore` interface (append, appendBatch, getById, getLastOfType, getRange, getPage(beforeMessageId, limit), scan/filter, delete) in `src/bun/conversation/message-store.ts`
- [x] 1.2 Implement `LegacySqliteConversationMessageStore` wrapping today's `conversation_messages` SQL, preserving exact current query behavior
- [x] 1.3 Implement the per-conversation in-process async write queue (`Map<conversationId, Promise<void>>` chain) as a small reusable utility
- [x] 1.4 Implement `FileConversationMessageStore`: JSONL append, line-number-as-id read, tombstone handling for corrupted lines
- [x] 1.5 Implement the `.meta.json` sidecar: atomic temp-file-then-rename writer, `lineCount`/`byteLength`/`lastCompactionSummaryId`/`lastCompactionSummaryByteOffset` fields, and a self-healing recompute path for drift
- [x] 1.6 Implement cursor-based paging (`beforeMessageId`/`limit`) against the file store using the sidecar to avoid full scans
- [x] 1.7 Implement compaction-anchor lookup against the file store using sidecar fields
- [x] 1.8 Implement the storage-medium resolver: given a `conversationId`, decide file-backed vs legacy-SQLite (e.g. based on a `conversations.storage_medium` column or presence-on-disk check) and return the correct store instance
- [x] 1.9 Add a migration that adds any new column(s)/flag needed for the resolver to distinguish file-backed vs legacy conversations
- [x] 1.10 Add a shared `ConversationMessageStore` contract test suite (same test cases run against both implementations) — see Testing section for full scenario list

## 2. Wire ConversationMessageStore into existing call sites

- [x] 2.1 Update `ConvMessageBuffer` to flush via the resolved `ConversationMessageStore.appendBatch()` instead of direct SQL
- [x] 2.2 Update `context.ts`, `context-estimator.ts`, `cross-engine-context.ts`, `decision-context-injector.ts` to use the injected store instead of raw `Database` queries
- [x] 2.3 Update `handlers/conversations.ts` (`getMessages`, `getContextUsage`, etc.) to delegate to the store
- [x] 2.4 Update `handlers/chat-sessions.ts` message-related paths to use the store
- [x] 2.5 Update `chat-executor.ts`, `human-turn-executor.ts`, `code-review-executor.ts` to construct/receive the store via DI instead of `getDb()`
- [x] 2.6 Update `board-tool-executor.ts` message read paths to use the store
- [x] 2.7 Remove the now-redundant direct-SQL helper functions in `src/bun/conversation/messages.ts` once all call sites are migrated
- [x] 2.8 Refactor `session-memory.ts`'s `extractSessionMemory`/`_doExtract` to accept an injected `ConversationMessageStore` instead of calling `getDb()` internally, resolving it via the same factory as every other call site
- [x] 2.9 Align `session-memory.ts`'s `~/.config/railyn/tasks/<id>/session-notes.md` path with the `~/.railyn` (`getDataDir()`) convention used elsewhere

## 3. Raw message debug log

- [x] 3.1 Implement the file-based debug log writer (`~/.railyn/conversations/<conversationId>.debug.<executionId>.jsonl`), reusing the same write-queue pattern as the message store
- [x] 3.2 Retarget `RawMessageBuffer` to flush into the debug log file instead of `model_raw_messages`
- [x] 3.3 Remove the `model_raw_messages` table usage from `RawMessageBuffer` and delete the now-unused SQL insert path
- [x] 3.4 Add a migration that drops the `model_raw_messages` table and its indices
- [x] 3.5 Update `RetentionJob` to delete debug log files older than 1 day instead of running a `model_raw_messages` DELETE

## 4. Remove stream_events persistence

- [x] 4.1 Remove `WriteBuffer<PersistedStreamEvent>` wiring, `appendStreamEventBatch`, and the `StreamBatcher`→`WriteBuffer` persistence hookup in `stream-processor.ts`
- [x] 4.2 Keep `StreamEventEnricher` and its `blockId`/`seq` enrichment for the live in-memory broadcast path only
- [x] 4.3 Delete `conversations.getStreamEvents` handler and its shared types in `src/shared/rpc-types.ts`
- [x] 4.4 Delete `src/bun/db/stream-events.ts` and any now-unused stream-events query helpers
- [x] 4.5 Remove the `RetentionJob` stream_events cleanup query
- [x] 4.6 Add a migration that drops the `stream_events` table and its indices
- [x] 4.7 Grep the frontend once more to confirm no remaining references to `getStreamEvents` before removing the RPC (defense-in-depth re-check of the earlier finding)

## 5. Deletion hooks

- [x] 5.1 Define the `ConversationFileDeleter` interface (`deleteConversationFiles(conversationId): Promise<void>`) and its single implementation, deleting `.jsonl`/`.meta.json`/debug-log files for a file-backed conversation and no-op'ing for a legacy one
- [x] 5.2 Inject `ConversationFileDeleter` into `tasks.ts`'s handler factory; update `tasks.delete` to call it after the SQL transaction commits
- [x] 5.3 Inject the same `ConversationFileDeleter` into `BoardToolExecutor`'s constructor (mirroring the existing optional `worktreeManager` param); update the AI-invoked task-deletion tool to call it
- [x] 5.4 Inject the same `ConversationFileDeleter` into `RetentionJob`'s constructor; update the archived-chat-session 7-day sweep to call it after the SQL cascade delete

## 7. Testing — unit (vitest)

- [x] 7.1 Write the `ConversationMessageStore` contract suite: run identical test cases (append, `getById`, `getLastByType`, `getRange`, `getPage`, `getAll`) against both `FileConversationMessageStore` (real tmpdir via `RAILYN_DATA_DIR` override) and `LegacySqliteConversationMessageStore` (in-memory DB), asserting identical observable behavior
- [x] 7.2 Test `FileConversationMessageStore`-specific behavior: line-number-as-id derivation, tombstone placeholder on a corrupted/partial line, sidecar atomic write (temp+rename), sidecar self-heal on byte-length drift, compaction-anchor lookup via sidecar fields
- [x] 7.3 Test the write queue: two `append()` calls fired without awaiting the first, then `Promise.all`'d, against a real tmpdir — assert exactly 2 well-formed JSON lines in issue order
- [x] 7.4 Test the resolver/factory: file-vs-legacy branch decision, asserting it is the sole medium-selection point
- [x] 7.5 Test `ConversationFileDeleter`: deletes `.jsonl`/`.meta.json`/debug-log files for a file-backed conversation; no-ops for a legacy conversation
- [x] 7.6 Write first-ever unit tests for `session-memory.ts`'s `_doExtract`, using a fake `ConversationMessageStore` injected per D11
- [x] 7.7 Update `conv-message-buffer.test.ts` to assert against the injected store's `appendBatch()` instead of raw `conversation_messages` SQL
- [x] 7.8 Update `retention-job.test.ts`: replace RJ-2 (`stream_events` pruning) with debug-log-file-age pruning assertions; extend RJ-5 (archived-session sweep) with `ConversationFileDeleter` file-deletion assertions (mocked collaborator)
- [x] 7.9 Update `handlers.test.ts`: add `tasks.delete` file-deletion-after-commit assertion (file-backed case) and no-op assertion (legacy case), using a mocked `ConversationFileDeleter`; remove the `conversations.getStreamEvents` test
- [x] 7.10 Update `context-estimator.test.ts`, `cross-engine-context.test.ts`, `decision-context-injector.test.ts`, `conversation-context.test.ts` to exercise both storage media via store-backed fixtures instead of direct `conversation_messages` SQL seeding
- [x] 7.11 Update `db-migrations.test.ts`: remove the `M-048c` (`stream_events` cascade) case; add "runs without error on existing data" cases for the migrations dropping `stream_events` and `model_raw_messages`

## 8. Testing — integration (e2e/api) and Playwright

- [x] 8.1 Add an `e2e/api` test seeding one file-backed and one legacy conversation in the same run, asserting `conversations.getMessages` pagination returns identical response shape/ordering from both (scoped to file-backed only via real RPC per decision — see notes)
- [x] 8.2 Confirm (compile-time + a runtime check if a generic unknown-method test exists) that `conversations.getStreamEvents` no longer exists as a handler
- [x] 8.3 Remove the stale `.returns("conversations.getStreamEvents", [])` default from `e2e/ui/fixtures/index.ts`
- [x] 8.4 Fix the outdated comment in `tool-rendering.spec.ts` that misattributes tool-message seeding to the removed `getStreamEvents` mock

## 9. Cleanup / simplification

- [x] 9.1 Delete `StreamBatcher` class entirely (superseded by `StreamEventEnricher` + direct broadcast)
- [x] 9.2 Remove now-dead migrations' runtime relevance from documentation/comments where they reference `stream_events`/`model_raw_messages` as active tables (leave migration files themselves as historical record, per project migration conventions)
- [x] 9.3 Sweep for any remaining direct `conversation_messages` SQL outside the store implementations and migrate or flag it

## 10. Final verification

- [x] 10.1 Run `bun test src/bun --timeout 20000` and fix any regressions from the DI/store refactor
- [x] 10.2 Run `bun test e2e/api --timeout 30000` to confirm RPC-level behavior (pagination, getMessages, compaction) is unchanged for both legacy and new conversations
- [x] 10.3 Manually verify: new task chat writes to `~/.railyn/conversations/<id>.jsonl`, existing pre-change tasks still read correctly from SQLite
- [x] 10.4 Manually verify: deleting a task removes its conversation file(s); running the retention sweep on an old archived chat session removes its conversation file(s)
- [x] 10.5 Run `openspec validate change-conversation-storage --strict` once more before archiving
