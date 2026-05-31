## Context

`ConversationBody.vue` builds `displayItems` by walking the loaded message slice and grouping adjacent `tool_call`/`tool_result` messages through `pairToolMessages`. That utility already handles subagent nesting (`children` array) via `metadata.parent_tool_call_id`. Before pagination existed, the whole conversation was loaded at once, so every parent was always present and the redundant guard at `ConversationBody.vue:158` (drop any top-level entry whose call has `parent_tool_call_id`) was a no-op — children always nested.

Cursor-based pagination changed the invariant: a page can contain subagent children whose parent lives in an older, not-yet-loaded page. `pairToolMessages` correctly returns those entries in `topLevel` (it cannot find a parent in `entryByCallId`), but `ConversationBody.vue:158` then silently drops them. With the brokers session (587 messages, 1 user prompt, 2 delegate parents, 287 tool pairs as children), the first 50-message page yields 21 child tool calls + 27 results + 1 reasoning + 1 assistant. The filter drops all 21, leaving 2 visible items.

This is a pure frontend rendering correctness bug. Backend `conversations.getMessages` is correct; `pairToolMessages` is correct; only the orphan filter is wrong under pagination.

## Goals / Non-Goals

**Goals:**
- Make subagent children always render — either nested under their parent when loaded, or as standalone top-level entries when the parent is in an older page slice.
- Centralize the nesting/orphan decision in `pairToolMessages` (single source of truth for parent/child relationships).
- Preserve the existing visual nesting for the happy path: when parent and children are on the same page they continue to render nested via `SubagentBlock`.

**Non-Goals:**
- Eagerly load the parent page when an orphan is detected. Cross-page reconciliation (re-nesting after `loadOlderMessages` brings the parent into view) is a separate concern and is naturally addressed by the existing `loadOlderMessages → messages.value = [...older, ...messages.value]` flow, which re-runs `pairToolMessages` over the merged slice and re-nests automatically.
- Backend changes. The fix is entirely in `src/mainview/utils/pairToolMessages.ts` and `src/mainview/components/ConversationBody.vue`.
- Visual redesign of subagent entries. Orphaned children render with the same `ToolCallBlock` component already in use; no new component or styling required for the minimal fix. A small visual hint ("from earlier subagent run") is optional and discussed under Risks.

## Decisions

### Decision 1 — Move the orphan filter into `pairToolMessages`, remove it from `ConversationBody`

`pairToolMessages` already builds `entryByCallId` and walks every entry to decide nesting vs top-level. It has the exact information needed: "did I find a parent in this slice?". The rule becomes:

```ts
for (const entry of allEntries) {
  const parentId = getParentCallId(entry.call);
  if (parentId) {
    const parent = entryByCallId.get(parentId);
    if (parent) { parent.children.push(entry); continue; }
    // parent not in this slice → render as top-level orphan (FALLTHROUGH)
  }
  topLevel.push(entry);
}
```

That is already what the current code does. The only change needed is to delete `ConversationBody.vue:158` so it stops second-guessing the result.

**Alternative considered**: keep the filter in `ConversationBody` and check `entryByCallId` there too. Rejected — it duplicates state that `pairToolMessages` already owns and violates SRP. The utility is the single source of truth for parent/child resolution.

**Alternative considered**: backend collapses subagent children into the parent payload so the frontend never sees them as separate rows. Rejected — invasive, breaks the existing live-stream path (which relies on flat `tool_call` events), and conflicts with the persisted-vs-streaming render parity already established by `chat-tool-call-rendering`.

### Decision 2 — No visual differentiation for orphaned children in this change

An orphaned subagent child renders exactly like any other top-level tool call. The user sees the child's `display.label` and `display.subject` and can expand it normally. Once they scroll up and `loadOlderMessages` brings the parent into the slice, `pairToolMessages` re-nests on the next reactive recompute.

**Alternative considered**: badge the orphan with a "subagent" pill or muted background. Deferred — adds UI scope without affecting correctness; can be a follow-up if users find the orphans confusing in practice.

### Decision 3 — Cover the regression with a `pairToolMessages` unit test

The existing `pairToolMessages.test.ts` already has a "nest subagent children under spawn_agent parent" test. Add one new test:

> *"orphaned subagent child (parent missing from input) is returned as a top-level entry"*.

This locks in the contract that `ConversationBody` now relies on.

## Risks / Trade-offs

- **[Risk]** Orphaned subagent children appear out-of-context (user sees a tool call with no obvious "why was this called?") → **Mitigation**: `display.label`/`display.subject` already make each tool call self-describing; users scrolling up will surface the parent and re-nesting happens automatically. A follow-up visual badge can be added later if needed.
- **[Risk]** A loaded page contains a parent whose children are entirely in the **newer** page (parent already loaded, children not yet streamed) → **Mitigation**: not a new risk — the parent renders alone (no children badge) and children attach when they arrive via the live-stream path (`StreamBlockNode`) or on next page refresh. Current behavior unchanged.
- **[Trade-off]** Top-level orphan tool calls increase the visible item count vs. the previous (buggy) behavior. This is the desired effect — users see more, not less — but it does mean `hasMoreBefore`-driven scroll loading behaves more naturally because each page contributes meaningful visible items.
