## 1. Extract `buildDisplayItems` utility

- [x] 1.1 Create `src/mainview/utils/buildDisplayItems.ts` — move the `displayItems` computed body from `ConversationBody.vue` (lines 138–170) into `export function buildDisplayItems(messages: ConversationMessage[], hasStreamTail: boolean): DisplayItem[]`. Re-export the `DisplayItem` type from the same file.
- [x] 1.2 Update `ConversationBody.vue`: import `buildDisplayItems` and replace the `computed(() => { … })` body with `computed(() => buildDisplayItems(props.messages, hasStructuredTail.value))`.
- [x] 1.3 Run `bun run build` — confirm no TypeScript errors.

## 2. Unit tests — `pairToolMessages.test.ts`

- [x] 2.1 Add test: *"orphaned subagent child (parent missing from input) is returned as a top-level entry"* — single `tool_call` with `metadata.parent_tool_call_id` set to an ID not present; assert `topLevel.length === 1` and `topLevel[0].call` is the orphan.
- [x] 2.2 Add test: *"mixed page — child with present parent nests; child with absent parent stays top-level"* — three entries: spawnCall, childA (parentId=spawnCall, present), childB (parentId=missingId, absent); assert `topLevel.length === 2` (spawnCall + childB), `topLevel[0].children.length === 1`.
- [x] 2.3 Run `bun test src/mainview/utils/pairToolMessages.test.ts` — all tests pass.

## 3. Unit tests — `buildDisplayItems.test.ts`

- [x] 3.1 Create `src/mainview/utils/buildDisplayItems.test.ts`.
- [x] 3.2 Add test: *"orphaned tool_call children produce tool_entry items (not dropped)"* — N `tool_call` messages all with `parent_tool_call_id` set to absent parent; assert result has N `kind:"tool_entry"` items.
- [x] 3.3 Add test: *"regular assistant/user messages produce single items"* — input: 2 assistant + 1 user; assert 3 `kind:"single"` items.
- [x] 3.4 Add test: *"`hasStreamTail: true` appends a stream_tail item"* — any non-empty messages; assert last item `kind:"stream_tail"`.
- [x] 3.5 Add test: *"tool block followed by assistant message splits correctly"* — [tool_call, tool_result, assistant]; assert result: [kind:"tool_entry", kind:"single"].
- [x] 3.6 Run `bun test src/mainview/utils/buildDisplayItems.test.ts` — all tests pass.

## 4. Playwright — `delegate-rendering.spec.ts` (S-D5)

- [x] 4.1 Add test S-D5: *"orphaned delegate children (parent on older page) render as standalone .tc cards"*. `getMessages` returns `{ messages: [child1, child2], hasMore: true }` (both children have `parent_tool_call_id` pointing to an absent parent). Assert `.conversation-inner .tc` count ≥ 2 and no `.delegate-divider` visible.

## 5. Playwright — `conversation-pagination.spec.ts` (PAG-11 + PAG-12)

- [x] 5.1 Add test PAG-11: *"orphaned subagent children render as standalone tool cards on initial page load"*. Seed `getMessages` with N orphaned `tool_call` + `tool_result` pairs, `hasMore: true`. Assert `.conv-body .tc` count equals N (not 0).
- [x] 5.2 Add test PAG-12: *"orphaned children re-nest under delegate parent after load-older pages in the parent"*. Two-phase mock: initial page returns children only; `beforeMessageId` page returns the delegate parent + result. Steps: open drawer → assert N standalone `.tc` cards → scroll to top → `await expect(page.locator('.delegate-divider')).toBeVisible({ timeout: 5_000 })` → assert `.tc` count drops (children nested inside delegate). No `waitForTimeout`.

## 6. Playwright — `chat-session-drawer.spec.ts` (CD-J)

- [x] 6.1 Add test CD-L: *"chat session with orphaned subagent tool calls renders .tc cards"*. Create a `makeChatSession`; `getMessages` returns orphaned `tool_call`/`tool_result` pairs with `parent_tool_call_id` set to absent parent, `hasMore: true`. Open session drawer. Assert `.session-chat-view .tc` count > 0.

## 7. Final verification

- [x] 7.1 Run `bun run build && npx playwright test e2e/ui/delegate-rendering.spec.ts e2e/ui/conversation-pagination.spec.ts e2e/ui/chat-session-drawer.spec.ts` — all new and existing tests pass.
- [x] 7.2 Run `bun test src/mainview/utils/` — all unit tests pass.
