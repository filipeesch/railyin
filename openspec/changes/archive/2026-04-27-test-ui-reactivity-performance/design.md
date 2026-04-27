## Context

`fix-ui-reactivity-performance` removes the `streamVersion` global counter, eliminates 6 Map clone sites, adds stream state memory cleanup, and refactors store boundaries. The existing `conversation.test.ts` has no coverage of stream block state whatsoever. There are no unit tests for `task.ts` or `chat.ts`. The existing Playwright suite has no streaming or rendering-isolation tests. This design defines the three-layer test strategy that guards all of these behaviors.

The test infrastructure already exists and must be reused:
- `vi.mock("../rpc", () => ({ api: apiMock }))` + dynamic import — the DI pattern for unit tests
- `setActivePinia(createPinia())` in `beforeEach` — fresh Pinia isolation per test
- `ApiMock` (page.route) + `WsMock` (routeWebSocket) — Playwright mock injection via extended fixture

## Goals / Non-Goals

**Goals:**
- Provide a regression guard that fails against current code and passes after the fix
- Cover stream block Map identity (SB-3: same Map instance after mutation)
- Cover rendering isolation (B-1: MutationObserver proves non-active DOM is untouched)
- Cover O(1) task lookup path through the public `onTaskUpdated` API
- Cover reactive Set mutations for unread IDs
- Cover multi-store dispatch ordering (conversation → task → chat)
- Cover auto-scroll behavior without `streamVersion`

**Non-Goals:**
- Backend or API tests (no production code changes in this change)
- Snapshot tests or visual regression
- Performance benchmarking / measurement tests
- Test coverage for waves not implemented yet

## Decisions

### D1: DI via module mock — no class extraction for `_replaceTask`

`loadTasks` already consumes `api` from `../rpc`, which is module-mocked via `vi.mock`. The correct DI test for `_replaceTask` is:
1. `apiMock.mockResolvedValueOnce([seed])` 
2. `await taskStore.loadTasks(boardId)` — seeds `tasksByBoard` through the mocked API
3. `taskStore.onTaskUpdated(updated)` — triggers `_replaceTask` via its public entry point
4. Assert both `tasksByBoard[boardId][0]` and `taskIndex[id]` are updated

No class extraction, no repository pattern, no interface needed. The module mock IS the constructor injection — same DI pattern already used in `conversation.test.ts`.

### D2: MutationObserver for rendering isolation (Playwright Suite B)

Asserting only final DOM state ("task B has no streaming class") is insufficient — a silent intermediate render could produce the correct final state while still causing a re-render. The correct assertion injects a `MutationObserver` on the active conversation's `.conv-body` before stream events are pushed for a background task, then asserts mutation count === 0.

Two assertions together make the test self-validating:
- **Positive proof**: unread dot appears on background task card (events DID process)
- **Negative proof**: `MutationObserver` count on active task's body === 0 (events did NOT leak into active DOM)

`characterData: true` must be included in the observer options to catch in-place text node updates (which reactive Map mutations produce — text node updates without element replacement).

### D3: Map identity guard as regression sentinel (Vitest SB-3)

The most precise test for "no clone" is a reference identity check:
```ts
const mapRef = store.streamStates.value          // capture Map instance
store.onStreamEvent(chunk)
expect(store.streamStates.value).toBe(mapRef)    // identity — not clone
```
This test fails against current code (a new Map is created) and passes after the fix. It cannot false-positive.

### D4: Separate `dispatch.test.ts` for multi-store ordering

Dispatch order (conversationStore → taskStore → chatStore) must be verified in a multi-store test. Unit tests of individual stores cannot catch this. `dispatch.test.ts` instantiates all three stores in one Pinia and verifies that when `onTaskStreamEvent` is called after `conversationStore.onStreamEvent`, the active stream state is already populated.

### D5: Auto-scroll covered by Playwright Suite E — not unit tests

The scroll behavior of `ConversationBody.vue` depends on DOM layout and `scrollTop`, which cannot be meaningfully tested in Vitest. Playwright is the right layer: open a conversation, push enough chunks to overflow the body, assert that the scroll position is at the bottom after each chunk.

## Risks / Trade-offs

- `MutationObserver` timing in Playwright depends on `page.waitForTimeout(200)` to let Vue flush — brittle if CI is slow → use `waitForFunction` polling `window.__mutCount` as a fallback if flaky
- `dispatch.test.ts` tests against the un-refactored store shape — tests must be written to match the post-refactor interface, so they should be written alongside Wave 3 implementation, not before
- `WsMock.pushStreamEvent` payload shape must match `rpc-types.ts` exactly — use the helper already in `e2e/ui/fixtures/mock-ws.ts`
