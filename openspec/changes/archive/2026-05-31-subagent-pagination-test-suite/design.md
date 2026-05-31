## Context

`fix-subagent-history-pagination` makes a surgical 1-line deletion in `ConversationBody.vue` and declares "extend `pairToolMessages.test.ts`" in its tasks — but the full test coverage contract (unit + Playwright) emerged through a separate design conversation after the proposal was written. This change captures all testing decisions made:

- **3 unit-test files** to cover the pure-function layer
- **3 Playwright spec extensions** to cover the DOM rendering layer
- **1 extraction refactor** (`buildDisplayItems`) that makes the component's display logic testable without mounting

The project follows the pattern: pure utilities live in `src/mainview/utils/*.ts` with co-located `.test.ts` files; Playwright specs mock the backend via `ApiMock` + `WsMock` and never touch a real Bun server.

## Goals / Non-Goals

**Goals:**
- Unit-test the orphaned-child path in `pairToolMessages` at the function level.
- Unit-test `buildDisplayItems` (the extracted computed) — including the orphan-child display scenario and mixed tool/non-tool batching.
- Playwright: assert orphaned `.tc` cards are visible in task drawer (PAG-11), re-nest after parent paged in (PAG-12), visible in chat session drawer (CD-J), and visible when initial page has children but no parent (S-D5).
- PAG-12 coordination via `waitForSelector` / DOM-change assertion rather than `waitForTimeout`.

**Non-Goals:**
- Backend or API integration tests — backend was never broken.
- Visual differentiation of orphaned children — deferred to a follow-up.
- Testing the `loadOlderMessages` store logic further — already covered by S-4…S-8 in `conversation.test.ts`.

## Decisions

### Decision 1 — Extract `buildDisplayItems` as a pure function

`ConversationBody.vue`'s `displayItems` computed batches adjacent tool messages, calls `pairToolMessages`, and maps to `DisplayItem[]`. This logic is:
- Untestable without mounting the Vue component
- The exact site where the orphan bug lived

Extract to `src/mainview/utils/buildDisplayItems.ts`:

```ts
export function buildDisplayItems(
  messages: ConversationMessage[],
  hasStreamTail: boolean,
): DisplayItem[]
```

`ConversationBody.vue` replaces the `computed(() => { … })` body with `computed(() => buildDisplayItems(props.messages, hasStructuredTail.value))`.

No test-only code paths. Dependency injection via function arguments. Follows the `pairToolMessages.ts` pattern exactly.

**Alternative considered**: test via `@vue/test-utils` component mount. Rejected — adds a heavy DOM dependency for a pure transformation; the function has no Vue-specific logic.

### Decision 2 — PAG-12 coordination strategy: DOM assertion over timing

PAG-12 (re-nest after parent paged in) is the most complex Playwright scenario. The flakiness risk is the gap between `loadOlderMessages` completing and Vue reactivity updating the DOM.

Strategy:
1. Mock `getMessages` to resolve **synchronously** on `beforeMessageId` check (no artificial delay).
2. After scroll triggers load-older, use `await expect(page.locator('.delegate-divider')).toBeVisible({ timeout: 5_000 })` as the coordination point — Playwright retries until the element appears.
3. No `waitForTimeout`, no fixed sleep.

This mirrors how PAG-3, PAG-8 already coordinate in `conversation-pagination.spec.ts`.

### Decision 3 — No new spec files; tests validate already-specified behaviour

The `chat-tool-call-rendering` spec in `fix-subagent-history-pagination` already captures the orphan scenario. This change adds tests that *verify* those requirements, not new requirements. Therefore `specs/` is empty — the spec delta lives in the parent change.

## Risks / Trade-offs

- **[Risk]** PAG-12 is still the most complex test: two-phase `getMessages` mock (initial page returns children, older page returns parent). If the IntersectionObserver fires before the test asserts the initial standalone state, the test window is missed. → **Mitigation**: assert the standalone `.tc` count first (before scrolling), then scroll and wait for `.delegate-divider`.
- **[Trade-off]** Extracting `buildDisplayItems` touches `ConversationBody.vue`'s computed definition. The change is a one-liner substitution, but it's a production file change for a test-quality benefit. Accepted — the extraction aligns with the project's existing util pattern and removes the risk of similar bugs hiding in untestable component logic.
