## ADDED Requirements

### Requirement: Compaction E2E tests — gauge refresh and error state
The test suite SHALL add two Playwright tests to `e2e/ui/extended-chat.spec.ts` Suite R, using the existing `api.handle()` mock infrastructure and WebSocket push helper.

#### Scenario: R-24 gauge drops immediately after successful compact
- **GIVEN** `conversations.contextUsage` returns `{ fraction: 0.9 }` on the first call and `{ fraction: 0.2 }` on subsequent calls
- **AND** `tasks.compact` mock pushes `message.new` with a `compaction_summary` message after 50 ms
- **AND** `models.listEnabled` returns a model with `supportsManualCompact: true`
- **WHEN** the user opens the task drawer, opens the context popover, and clicks "Compact"
- **THEN** the `.ctx-popover__pct` element updates from `"90%"` to `"20%"` within 5 seconds

#### Scenario: R-25 already-compacting error is visible after failed compact
- **GIVEN** `tasks.compact` mock throws (or returns a 500) with message `"Compaction already in progress"`
- **AND** `models.listEnabled` returns a model with `supportsManualCompact: true`
- **WHEN** the user clicks "Compact"
- **THEN** an error notification or toast is visible in the page within 3 seconds
