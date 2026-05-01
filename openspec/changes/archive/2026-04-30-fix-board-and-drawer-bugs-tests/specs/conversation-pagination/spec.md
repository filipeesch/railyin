## ADDED Requirements

### Requirement: load-older fires when sentinel is visible at autoScroll disable
`e2e/ui/conversation-pagination.spec.ts` SHALL include PAG-9 verifying that `loadOlderMessages` is triggered when the sentinel element is already within the viewport at the moment `autoScroll` transitions from `true` to `false`. The test uses `evaluate(el => el.scrollTop = 0)` to force the transition, consistent with existing PAG tests.

#### Scenario: PAG-9 — load-older emitted when sentinel already visible on scroll-up
- **WHEN** the conversation has `hasMore: true` with few enough messages that the sentinel is visible
- **AND** `scrollTop` is set to `0` via `evaluate()` to disable autoScroll
- **THEN** `conversations.getMessages` is called a second time (load-older triggered by the watcher)
