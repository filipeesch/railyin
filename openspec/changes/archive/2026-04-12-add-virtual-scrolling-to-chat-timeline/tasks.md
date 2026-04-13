## 1. Dependency Setup

- [x] 1.1 Install `@tanstack/vue-virtual` (`bun add @tanstack/vue-virtual`) and verify it appears in `package.json` and `bun.lock`

## 2. Virtual List Integration in TaskDetailDrawer.vue

- [x] 2.1 Import `useVirtualizer` from `@tanstack/vue-virtual` in the `<script setup>` block
- [x] 2.2 Create the `useVirtualizer` instance: `count = displayItems.value.length`, `getScrollElement = () => scrollEl.value`, `estimateSize = () => 200`, `overscan = 5`
- [x] 2.3 Replace the `.conversation-inner` wrapper div and `<template v-for>` with a `position: relative` spacer div whose `height` is bound to `virtualizer.getTotalSize()`
- [x] 2.4 Inside the spacer, render only `virtualizer.getVirtualItems()` — each wrapped in a `position: absolute` div with `top: vitem.start`, `width: 100%`, `padding-bottom: 8px`, `:key="displayItems[vitem.index].key"`, and `:ref="el => el && virtualizer.measureElement(el)"` and `:data-index="vitem.index"`
- [x] 2.5 Inside each virtual item wrapper, render the existing `<ToolCallGroup>`, `<CodeReviewCard>`, or `<MessageBubble>` conditional block, indexed by `displayItems[vitem.index]`
- [x] 2.6 Remove the `<TransitionGroup name="chat-item">` wrapper around the `v-for` (animations don't apply to virtual items; `.chat-items { display: contents }` and `.chat-item-enter-*` CSS can be removed too)
- [x] 2.7 Leave the streaming tail in place after the spacer div — this is now: `<StreamBlockNode v-for rootId in activeStreamState.roots>`, the ephemeral status div, and the legacy fallback (`<ReasoningBubble>` / streaming token div). These are already in normal flow inside `.conversation-inner` after `displayItems`; they naturally follow the virtual spacer with no changes needed

## 3. Auto-Scroll & State Reset

- [x] 3.1 Verify that the existing `scrollToBottom()` function (`scrollEl.scrollTop = scrollEl.scrollHeight`) still works correctly with the virtual spacer — open a task and confirm new messages scroll to bottom
- [x] 3.2 Add a `watch` on `taskStore.activeTaskId` (or confirm the existing one) that calls `virtualizer.scrollToOffset(0)` or resets measured sizes when the active task changes, preventing stale heights from a previous task affecting the new one. Simplest approach: use a `:key` binding on the scroll container tied to `taskStore.activeTaskId` to force remount the virtualizer
- [x] 3.3 Confirm that the `autoScroll` pause/resume logic (scroll within 60px of bottom) still works — the `onScroll` handler reads `scrollTop`/`scrollHeight`/`clientHeight` from `scrollEl`, which is unchanged

## 4. CSS Cleanup

- [x] 4.1 Remove the `.conversation-inner` CSS rule (`display: flex; flex-direction: column; gap: 8px`) since it no longer applies — gap is now handled by `padding-bottom: 8px` on each virtual item wrapper
- [x] 4.2 Verify no visual regressions in the spacing between items (tool call groups, message bubbles, code review cards)

## 5. Verification

- [ ] 5.1 Open a task with 50+ messages — confirm DOM node count is bounded (~25 conversation item nodes) using browser devtools
- [ ] 5.2 Type in the chat input with a long conversation open — confirm no lag
- [ ] 5.3 Scroll up in a long conversation, send a new message — confirm scroll position is not hijacked
- [ ] 5.4 Scroll back to the bottom — confirm auto-scroll resumes for the next message
- [ ] 5.5 Open a second task after viewing a long one — confirm layout is correct and scroll is at the bottom
- [ ] 5.6 Expand and collapse a ToolCallGroup accordion in the virtual list — confirm items below reposition correctly
- [x] 5.7 Run `bun test src/bun/test --timeout 20000` to confirm no backend regressions
