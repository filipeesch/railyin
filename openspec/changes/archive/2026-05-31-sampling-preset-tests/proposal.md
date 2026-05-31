## Why

The `sampling-preset-per-conversation` feature introduces new backend classes, DB changes, RPC methods, and frontend components with no corresponding tests. Without a test suite, the resolution chain, executor enrichment, and UI behaviour are unverified and vulnerable to regressions.

## What Changes

- Add `execution-params-enricher.test.ts` (new) — unit tests for `ExecutionParamsEnricher` covering all 4-level resolution chain scenarios.
- Extend `transition-executor.test.ts` — 3 new tests verifying conversation override beats column preset.
- Extend `human-turn-executor.test.ts` — 3 new tests; these also serve as regression tests proving the existing bug (missing `samplingPresetName`) is fixed.
- Extend `retry-executor.test.ts` — 2 new tests for preset propagation.
- Extend `chat-executor.test.ts` — 3 new tests for conversation override in session context.
- Extend `model-handlers.test.ts` — 3 new tests for `availablePresets` on `ModelInfo` for Pi models.
- Extend `handlers.test.ts` — 3 new tests for `conversations.setSamplingPreset` handler.
- Extend `db-migrations.test.ts` — 1 test confirming migration 047 adds `sampling_preset_override` column.
- Update `helpers.ts` — add `sampling_preset_override TEXT NULL` to inline `conversations` DDL in `initDb()` so executor tests can set the override without running real migrations.
- Add `e2e/ui/sampling-preset.spec.ts` (new) — ~10 Playwright tests covering selector rendering, dropdown details, and persistence for both TaskChatView and SessionChatView.
- Extend `e2e/ui/fixtures/mock-data.ts` — add `samplingPresetOverride` field to `makeTask`/`makeChatSession`, add `availablePresets` to the Pi model fixture.

## Capabilities

### New Capabilities

- `sampling-preset-test-suite`: Full test coverage for the `sampling-preset-per-conversation` feature — unit, in-memory DB integration, and Playwright UI tests.

### Modified Capabilities

_(none — this change only adds tests and updates test fixtures)_

## Impact

- **Test files modified**: `helpers.ts`, `transition-executor.test.ts`, `human-turn-executor.test.ts`, `retry-executor.test.ts`, `chat-executor.test.ts`, `model-handlers.test.ts`, `handlers.test.ts`, `db-migrations.test.ts`, `mock-data.ts`.
- **Test files added**: `execution-params-enricher.test.ts`, `e2e/ui/sampling-preset.spec.ts`.
- **No production code changes** — test infrastructure only.
- Depends on `sampling-preset-per-conversation` being implemented first.
