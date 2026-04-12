## Context

`TaskDetailDrawer.vue` renders all conversation messages via a `v-for` loop over a `displayItems` computed array. Items are one of three types: `tool_entry` (a `ToolCallGroup` accordion, potentially containing recursive sub-tool-call trees), `code_review`, or `single` (a `MessageBubble`). The scroll container (`task-detail__conversation`) has `overflow-y: auto` and a `scrollEl` ref. Auto-scroll-to-bottom is implemented with a simple `scrollTop = scrollHeight` pattern, paused when the user scrolls up and resumed when they return within 60px of the bottom.

The problem: with 200+ items in the DOM, the browser recalculates layout for every node on any interaction — typing in the chat input, resizing the drawer, even mouse movement. This is the primary source of perceived lag.

## Goals / Non-Goals

**Goals:**
- Replace the `v-for` list with `@tanstack/vue-virtual` windowed rendering
- Only ~15 items (visible + overscan 5) are in the DOM at any time
- Dynamic height measurement via `ResizeObserver` (`measureElement`) corrects initial estimates after first render
- Auto-scroll-to-bottom behavior is fully preserved
- Typing in the chat input is smooth regardless of conversation length

**Non-Goals:**
- Flattening the `ToolEntry` tree into the virtual list (individual sub-tool-calls as separate virtual items) — deferred to a potential phase 2
- Modifying `ToolCallGroup.vue`, `MessageBubble.vue`, `CodeReviewCard.vue`, or `pairToolMessages.ts`
- Virtualizing the recursive children inside a single `ToolCallGroup` item
- Any changes to the streaming tail (ReasoningBubble, live token div, status spinner)

## Decisions

### Decision: @tanstack/vue-virtual over vue-virtual-scroller

`vue-virtual-scroller` wraps items in its own component hierarchy and expects all items to be inside a single scroller component. The streaming tail (ReasoningBubble + live token div) must remain *after* the virtual list in normal document flow — it's ephemeral, always at the bottom, and not part of `displayItems`. TanStack Virtual is headless (just math + refs), so the streaming tail stays exactly where it is. It also has first-class support for `measureElement`-based dynamic sizing and a simpler API for `scrollToOffset`.

### Decision: Treat each `tool_entry` as one opaque virtual item

A single `ToolCallGroup` can be very tall (a spawned sub-agent with dozens of nested tool calls), but `measureElement` handles this — TanStack measures the rendered height and corrects the virtual position of all subsequent items. Flattening the tree would require extracting expand/collapse state from `ToolCallGroup`, managing visual connectors across virtual item boundaries, and estimating depth-indented heights — not worth it for the gains in phase 1.

### Decision: Streaming tail stays outside the virtual list

The unified stream blocks (`<StreamBlockNode v-for rootId in activeStreamState.roots>`), ephemeral status div, and legacy fallback (ReasoningBubble + streaming token) exist in normal flow after the virtual spacer div inside `.conversation-inner`. They don't belong in `displayItems` — they are live/ephemeral and transition to `displayItems` once persisted. The virtual spacer sits before them in the flex column; `.conversation-inner`'s `gap: 8px` provides spacing between the spacer and first stream block naturally. `scrollToBottom()` continues to work via `scrollEl.scrollTo({ top: scrollEl.scrollHeight })` — unchanged.

### Decision: Initial height estimate of 200px per item

This is a rough average across message types. TanStack corrects measured heights after first render. Using a larger estimate (vs. 50px) reduces the number of items rendered on first paint (fewer items fill the viewport initially), which speeds up initial mount. Type-based estimates (80px for single, 300px for tool_entry) were considered but add complexity without meaningful UX benefit given that measurement corrects quickly.

### Decision: Overscan of 5

5 items above and below the viewport are kept mounted. This gives a scroll buffer so fast scrolling doesn't expose blank space. Default is 3; 5 is appropriate for items with variable heights (especially tall ToolCallGroups) where scroll speed vs. DOM budget tradeoff favors slightly more buffer.

### Decision: Spacer div replaces `.conversation-inner`

Currently `.conversation-inner` is a flex column with `gap: 8px`. With virtual scrolling, items are absolutely positioned. The spacer div gets `position: relative; height: virtualizer.getTotalSize()`. Per-item gap is replicated by adding `padding-bottom: 8px` to each virtual item wrapper div — `measureElement` measures the wrapper including padding, so the 8px gap is correctly accounted for in the total size.

## Risks / Trade-offs

- **First-render position jump** → When a task opens, TanStack renders with estimated heights (200px), then measures and re-positions. On tasks with large items, visible items can shift. Mitigation: run `scrollToBottom()` after `nextTick()` in the existing `activeTaskId` watcher (already present), which will scroll to the corrected bottom after measurement.

- **Stale sizes on task switch** → When switching between tasks, the virtualizer retains measured sizes for old items at the same indices. Mitigation: destroy and recreate the virtualizer when `activeTaskId` changes by keying the virtualizer setup to `taskStore.activeTaskId` (reset via `watchEffect` or by using a `:key` on the container element).

- **ResizeObserver cost** → TanStack attaches a `ResizeObserver` to each rendered item (~15 at a time). This is negligible compared to the cost of 200+ full DOM nodes.

- **Absolute positioning breaks natural flow** → Items can no longer rely on parent flex gap for spacing. Mitigated by the `padding-bottom: 8px` wrapper approach.

- **`<TransitionGroup>` wraps `displayItems`** → Main added a `<TransitionGroup name="chat-item">` around the `v-for`. Its inner div uses `display: contents` (layout-transparent), and the enter/exit CSS animations won't fire for virtually-rendered items anyway. The `<TransitionGroup>` must be removed when replacing the v-for with the virtual list.

## Migration Plan

1. Install `@tanstack/vue-virtual` (`bun add @tanstack/vue-virtual`)
2. Modify `TaskDetailDrawer.vue` template and script (see tasks)
3. Verify: open a long task (50+ messages), confirm smooth scrolling and typing
4. Verify: streaming auto-scroll still reaches the bottom
5. Verify: manual scroll-up is preserved; new messages don't yank the view

Rollback: revert the single-file change to `TaskDetailDrawer.vue` and remove the dependency.

## Open Questions

- Should we add a `data-index` attribute to virtual item wrappers for debugging/testing purposes? (Low priority — not needed for correctness.)
- If a user has a task open when the feature ships (no page reload), will the virtualizer initialise correctly on the already-open drawer? (Yes — `onMounted` runs when the component is mounted; the drawer being open is just a conditional render of the same component.)
