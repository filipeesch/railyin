## Context

The conversation UI has two rendering paths that must be kept in sync: the live stream path (`StreamBlockNode.vue`, reactive `StreamBlock` map) and the persisted path (`ToolCallGroup.vue`, DB-loaded `ConversationMessage[]`). Both paths render the same tool call blocks but with different data shapes. A series of bugs accumulated because fixes applied to one path were never mirrored to the other, and because `StreamBlockNode` became a god component (~350 lines) handling all block types inline.

Current state of bugs:
1. `stream-processor.ts` incorrectly assigns `reasoningBlockId` as the parent of subsequent tool_call/tool_result blocks — nesting them inside the `ReasoningBubble` slot and hiding them when it collapses.
2. `copilot/events.ts` marks ALL tools with `parentToolCallId` as `isInternal`, suppressing subagent tool calls from the live stream entirely.
3. `claude/events.ts` passes `block.content` directly to tool result, but Claude's API returns it as `Array<{type:'text',text:string}>` when multi-part — causing JSON display or missing results.
4. `buildCopilotNativeDisplay("edit")` does not extract `startLine` from args, so ReadView always renders from line 1.
5. `common-tools.ts` `executeCommonToolText` returns raw `JSON.stringify`, which the frontend renders as a `<pre>` block since no `detailedContent` field is present.
6. Display builder functions for bash/terminal tools have no access to `worktreePath`, so subjects show full absolute paths that get truncated.
7. `ConversationBody.vue` `.conv-body` has `overflow-y: auto` but no `overflow-x: hidden`, causing child elements with wide content (ReadView, FileDiff, pre blocks) to propagate a horizontal scrollbar to the outer chat panel.
8. `MessageBubble.vue` user message branch renders via `InlineChipText` (no markdown), so decision answer messages show raw `**bold**` asterisks. The `DecisionRequest` answered-view parser looks for `"A: "` but the stored format is `"**A:** "`, so all answers show `—`.

## Goals / Non-Goals

**Goals:**
- Fix all 9 rendering bugs with surgical, targeted changes in each responsible file
- Decompose `StreamBlockNode.vue` into a pure router that delegates to sub-components
- Create `ToolCallBlock.vue` as a shared component used by both render paths via a normalized `ToolCallProps` interface
- Extract `useToolResultDisplay` composable to consolidate result text extraction
- Add subagent pulse animation: spawning tool icon pulses while its children are still streaming
- Render user messages with markdown; remove the broken/redundant `DecisionRequest` answered-view block

**Non-Goals:**
- No changes to DB schema or API contracts — `formattedContent` field already exists on `tool_result`
- No changes to how messages are loaded/paginated
- No changes to the `ask_user_prompt` rendering path (separate component, works correctly)
- No test suite additions in this change (tackled separately)
- No changes to `ModelTreeView` "Enable thinking" toggle (unrelated API feature name)

## Decisions

### D1 — Remove `reasoningBlockId` fallback from toolParentBlockId assignment

**Decision:** Drop `?? reasoningBlockId` from both the `tool_call` and `tool_result` parent block assignments in `stream-processor.ts`.

**Rationale:** `reasoningBlockId` tracks the last emitted reasoning block for internal stream accounting. It should never be used as a UI parent for tool calls — the tool call is a sibling of the reasoning block, not a child. The fallback was added erroneously. After removal, `toolParentBlockId = event.parentCallId ?? null`, which is correct: top-level tools have null parent, subagent tools carry their own `parentCallId`.

**Alternative considered:** Keep `reasoningBlockId` but use it only for the reasoning-chunk scope tracking (where it's used correctly). Rejected as too complex — the bug is the assignment, not the variable.

---

### D2 — Fix `isInternalCopilotEvent` to only suppress truly internal tools

**Decision:** Remove the `if (parentToolCallId) return true` guard from `isInternalCopilotEvent()`. Retain guards for `skill-*` source, `report_intent`, `internal_*`, and `copilot_*` prefix tools.

**Rationale:** The guard was intended to hide framework scaffolding tools from the UI. Subagent tools are not scaffolding — they're user-visible work. The infrastructure for nested rendering already exists: `parentCallId` flows through to `parentBlockId` in stream events, and `StreamBlockNode` already renders children recursively inside the spawning tool's expanded body.

---

### D3 — Normalize Claude array content in `claude/events.ts` using `formattedContent`

**Decision:** At the point where `block.content` is assigned to `tool_result.result`, check if it's an array and join text parts: `Array.isArray(content) ? content.filter(b => b.type==='text').map(b => b.text).join('\n') : content`. Store as `formattedContent` field.

**Rationale:** `formattedContent` is already the priority-1 field in `extractToolResultText()` in `conversation.ts`. Normalizing at the source keeps all downstream consumers consistent without touching the pipeline.

---

### D4 — Normalized `ToolCallProps` interface as the shared component contract

**Decision:** Define a `ToolCallProps` interface in `src/mainview/components/ToolCallBlock.vue` (or a types file). Both callers adapt their own data shape:
- `ToolCallGroup` adapts `ToolEntry → ToolCallProps`
- `StreamBlockNode` adapts `StreamBlock → ToolCallProps`

```typescript
interface ToolCallProps {
  callId: string
  label?: string
  subject?: string
  contentType?: 'file' | 'terminal'
  startLine?: number
  status: 'pending' | 'done' | 'error'
  result: { content: string; isError: boolean } | null
  diffPayloads: FileDiffPayload[]
  children: ToolCallProps[]    // recursive for subagents
}
```

**Rationale:** Each caller already has a localized adapter step (computed properties). Adding a small normalization layer keeps `ToolCallBlock` independently testable and prevents the god-component pattern from re-emerging.

**Alternative considered:** Pass raw `StreamBlock | ToolEntry` as a union type. Rejected — forces `ToolCallBlock` to import both types and branch internally, defeating the decomposition.

---

### D5 — Subagent pulse animation: pulse the spawning tool icon while `done=false`

**Decision:** In `ToolCallBlock.vue`, apply the `pi-sitemap` badge icon pulsing animation when `status === 'pending'` (i.e., the block's `done=false`) and `children.length > 0`. Reuse the `pulse` keyframe from `ReasoningBubble.vue`.

**Rationale:** The `ReasoningBubble` precedent shows this is the right UX pattern for "AI is working on something". For subagents, the spawning tool `done=false` maps directly to the agent still running. The pulse disappears when `done=true`, providing clear completion feedback.

---

### D6 — Pass `worktreePath` to display builder functions

**Decision:** Add an optional `worktreePath?: string` parameter to `buildCopilotNativeDisplay`, `buildClaudeBuiltinDisplay`, and `translateCopilotStream`/`translateClaudeMessage`. For bash/terminal subjects, strip any leading `worktreePath` prefix using `path.relative()`. Callers in `stream-processor.ts` pass the workspace's worktreePath if available.

**Rationale:** Full absolute paths are never useful in the UI subject. The worktree path is known in `stream-processor.ts` where executions are spawned. The display builder functions are pure functions — adding an optional param is non-breaking.

---

### D7 — Remove `DecisionRequest` answered-view block; render user messages with markdown

**Decision:** 
1. In `MessageBubble.vue`, change the `user` type branch to render with `renderMd(displayContent)` + `.prose` class (same pattern as assistant messages).
2. In `DecisionRequest.vue`, remove the `v-if="answered"` branch entirely. When `answeredText !== undefined`, render nothing (the `<template>` returns `null` when answered).

**Rationale:** The answered-view block is broken (parser mismatch) and redundant — the user bubble immediately below in the conversation already shows the full Q&A content. With markdown rendering on user messages, the Q&A will display cleanly with bold labels and code formatting. The `InlineChipText` `/command` chip styling is a nice-to-have for regular chat input; its loss is acceptable given the benefit of markdown support.

## Risks / Trade-offs

- **D7: Loss of `/cmd` chip pills in user bubbles** — `InlineChipText` renders `/prompt-name` as styled pill badges. Switching to `renderMd()` loses this for regular chat messages. Mitigation: Accept for now; `renderMd()` renders them as inline code which is still readable. Can revisit with a custom markdown plugin later.

- **D1: `reasoningBlockId` still used elsewhere** — The variable has other uses (tracking reasoning accumulator flushing). Only the two `toolParentBlockId` assignment lines are changed; the variable is kept for its correct uses. → Mitigation: careful surgical change, not removal of the variable.

- **D6: `worktreePath` not always available** — Chat sessions (not task-based) may not have a worktree path. → Mitigation: param is optional; display builders fall through gracefully when undefined.

- **StreamBlockNode decomposition scope** — Extracting `ToolCallBlock.vue` is the primary decomposition. `AssistantBlock`, `FileDiffBlock`, `SystemBlock` extraction is deferred — the immediate value comes from the tool call unification. `StreamBlockNode` becomes a router with the remaining block types rendered inline but cleanly.

## Migration Plan

1. All changes are frontend-only except backend fixes (Issues 1-7). No DB migration needed.
2. Backend fixes can be deployed independently — they improve the data emitted by the stream but the frontend handles old and new shapes gracefully.
3. `ToolCallBlock.vue` is new; `StreamBlockNode` and `ToolCallGroup` become wrappers. If decomposition is incomplete, both can fall back to their inline rendering temporarily.
4. No rollback strategy needed beyond reverting the git commit — all changes are isolated to component and utility files.

## Open Questions

- None — all design decisions are locked via decision_request records.
