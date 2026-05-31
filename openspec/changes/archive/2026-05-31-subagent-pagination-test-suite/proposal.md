## Why

`fix-subagent-history-pagination` removes the orphan-filter bug in `ConversationBody.vue`, but the change currently has no test coverage for the exact failure mode: subagent children arriving on a paginated page whose delegate parent lives in an older, not-yet-loaded slice. This change adds the full test suite — unit, component-level, and Playwright E2E — that would have caught the regression and will prevent recurrence.

## What Changes

- Add `src/mainview/utils/buildDisplayItems.ts` — extract the `displayItems` computed from `ConversationBody.vue` into a pure, testable function.
- Add `src/mainview/utils/buildDisplayItems.test.ts` — unit tests for the extracted function, including the orphan-child rendering scenario.
- Extend `src/mainview/utils/pairToolMessages.test.ts` — two new test cases: orphaned child (parent absent), and mixed same-page/orphaned children.
- Extend `e2e/ui/delegate-rendering.spec.ts` — S-D5: children present, parent on older page; assert `.tc` cards visible.
- Extend `e2e/ui/conversation-pagination.spec.ts` — PAG-11 (orphan renders standalone) and PAG-12 (re-nest after parent paged in, using `waitForSelector` not `waitForTimeout`).
- Extend `e2e/ui/chat-session-drawer.spec.ts` — CD-J: session with orphaned tool calls renders `.tc` cards.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
<!-- none — no spec-level requirement changes; tests are validating already-specified behaviour from fix-subagent-history-pagination -->

## Impact

- **Code (production)**: `src/mainview/components/ConversationBody.vue` imports `buildDisplayItems` instead of inlining the computed; `src/mainview/utils/buildDisplayItems.ts` added. No logic change — extraction only.
- **Code (tests)**: four test files extended or created.
- **No backend changes.**
- **Depends on**: `fix-subagent-history-pagination` must be applied first (the orphan filter removed) or the new tests will fail as expected regressions.
