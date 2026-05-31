## 1. Frontend fix

- [ ] 1.1 Delete the orphan-child filter at `src/mainview/components/ConversationBody.vue:158` (`if (typeof meta?.parent_tool_call_id === "string") continue;`) so `ConversationBody` trusts the `topLevel` array returned by `pairToolMessages`.
- [ ] 1.2 Verify `src/mainview/utils/pairToolMessages.ts` already promotes a child whose parent is missing from `entryByCallId` to `topLevel`. If not, confirm the existing fall-through path keeps it as top-level — no code change required in the utility itself, only in the consumer.
- [ ] 1.3 Create `src/mainview/utils/buildDisplayItems.ts` — extract the `displayItems` computed body (lines 138–170) from `ConversationBody.vue` into `export function buildDisplayItems(messages: ConversationMessage[], hasStreamTail: boolean): DisplayItem[]`. Re-export `DisplayItem` type from the same file.
- [ ] 1.4 Update `ConversationBody.vue` to import `buildDisplayItems` and replace the `computed` body with `computed(() => buildDisplayItems(props.messages, hasStructuredTail.value))`.
- [ ] 1.5 Run `bun run build` — confirm no TypeScript errors.

## 2. Manual verification

- [ ] 2.1 Rebuild the frontend: `bun run build`.
- [ ] 2.2 In the running app at `http://127.0.0.1:3000/board`, switch to the Quinto Andar workspace, open the "brokers" chat session, and confirm the first page renders dozens of tool entries (not just 1-2 items) including the previously-orphaned subagent children.
- [ ] 2.3 Scroll up to load older pages and confirm: (a) more content keeps loading on each scroll; (b) when the `delegate` parent eventually paginates in, the children re-nest under it (badge appears, top-level orphans disappear).
- [ ] 2.4 Open a plain chat session with no subagent calls and confirm rendering is unchanged (regression check on the happy path).

## 3. Documentation

- [ ] 3.1 Update the doc block above `pairToolMessages` in `src/mainview/utils/pairToolMessages.ts` to explicitly state that orphaned subagent children (parent not present in the input slice) are returned at the top level so the consumer can render them standalone.
