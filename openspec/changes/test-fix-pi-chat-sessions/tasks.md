## 1. Test infrastructure additions

- [x] 1.1 Add `seedChatSession(db, overrides?)` helper to `src/bun/test/helpers.ts` — inserts a `chat_sessions` row with a linked `conversations` row, returning `{ sessionId, conversationId }`
- [x] 1.2 Verify `initDb()` in `helpers.ts` already creates `chat_sessions` and `model_settings` tables (no schema changes expected — just confirm)

## 2. ChatExecutor unit tests (`src/bun/test/chat-executor.test.ts`)

- [x] 2.1 CE-1 — **contextWindowOverride injected**: given a model with a configured context window, assert `ExecutionParams.contextWindowOverride` equals the value from `ModelSettingsRepository`
- [x] 2.2 CE-2 — **boardTools injected**: assert `ExecutionParams.boardTools` is the `IBoardToolExecutor` instance passed at construction
- [x] 2.3 CE-3 — **pre-flight fires for Pi + no context window**: given a Pi model with no context window, assert no `executions` row is created and a `conversation_messages` row with `type = "system"` is persisted
- [x] 2.4 CE-4 — **onNewMessage called on pre-flight**: same setup as CE-3, assert the captured `onNewMessage` spy was called exactly once with a system-typed `ConversationMessage`
- [x] 2.5 CE-5 — **pre-flight does NOT fire for Pi + context window configured**: assert stream processor is invoked and no system message is persisted
- [x] 2.6 CE-6 — **pre-flight does NOT fire for Claude + no context window**: assert no system message is persisted and stream processor is invoked
- [x] 2.7 CE-7 — **onNewMessage NOT called on successful execution (pre-flight scope)**: assert spy is `null` after a successful Claude or Pi (configured) execution

## 3. ExecutionParams builder tests (extend `src/bun/test/execution-params-builder.test.ts`)

- [ ] 3.1 EPB-CHAT-1 — assert chat session params include `contextWindowOverride` when model settings return a value
- [ ] 3.2 EPB-CHAT-2 — assert chat session params have `contextWindowOverride: undefined` when model settings return `null`

## 4. Playwright UI tests (`e2e/ui/chat-session-drawer.spec.ts`)

- [ ] 4.1 CD-L-1 — **Pi error message rendered**: mock `message.new` WS event with `type = "system"` for a Pi session; assert the system message bubble appears in the conversation panel with the correct CSS class
- [ ] 4.2 CD-L-2 — **Claude chat unaffected**: mock a normal Claude chat exchange; assert no system message bubble appears and the assistant reply is visible

## 5. Verify test suite passes

- [x] 5.1 Run `bun test src/bun/test --timeout 20000` and confirm all new tests pass with no regressions
- [ ] 5.2 Run `bun run build && npx playwright test e2e/ui/chat-session-drawer.spec.ts` and confirm both Playwright specs pass

