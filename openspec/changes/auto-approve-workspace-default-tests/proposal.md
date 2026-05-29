## Why

The `auto-approve-workspace-default` feature introduces new behavior across the config layer, backend handlers, and frontend UI. That behavior needs a dedicated test suite so it can be verified without relying solely on manual QA.

## What Changes

- Add backend unit tests to `src/bun/test/workspace-handlers.test.ts` covering `workspace.getConfig` and `workspace.update` for the new `shellAutoApprove` field.
- Add backend integration tests to `src/bun/test/handlers.test.ts` covering `tasks.create` seeding `shell_auto_approve` from the workspace config (creation-time seed, not live override).
- Update `makeWorkspace` factory in `e2e/ui/fixtures/mock-data.ts` to include `shellAutoApprove: false` by default (required for TypeScript correctness after `WorkspaceConfig` is extended).
- Add Playwright UI tests to `e2e/ui/workspace-settings.spec.ts` covering toggle rendering, initial value from config, and save payload correctness.

## Capabilities

### New Capabilities

_(none — this is a test-only change building on `auto-approve-workspace-default`)_

### Modified Capabilities

_(none — no spec-level requirement changes; this change only adds test coverage)_

## Impact

- `src/bun/test/workspace-handlers.test.ts` — extended with 6 new cases
- `src/bun/test/handlers.test.ts` — extended with 4 new cases inside `tasks.create` describe block
- `e2e/ui/fixtures/mock-data.ts` — `makeWorkspace` factory gains `shellAutoApprove: false` default
- `e2e/ui/workspace-settings.spec.ts` — extended with 5 new cases in Suite W
