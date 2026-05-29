## Context

The `auto-approve-workspace-default` change adds `shell_auto_approve` as a workspace-level seed, surfaced through `workspace.getConfig`/`workspace.update` handlers and `tasks.create`. The test suite uses the project's existing in-memory DB infrastructure (`setupTestConfig`, `initDb`, `makeHandlers`) and Playwright mock-API layer (`ApiMock`, `makeWorkspace`, `makeTask`) — no new tooling needed.

## Goals / Non-Goals

**Goals:**
- Cover `workspace.getConfig` and `workspace.update` for the new `shellAutoApprove` field at the unit level.
- Cover `tasks.create` seeding `shell_auto_approve` from workspace config in the integration layer.
- Verify task independence post-creation (seed-only, not live override).
- Cover toggle rendering, initial value, and save payload in the Playwright layer.
- Keep `makeWorkspace` factory type-correct after `WorkspaceConfig` gains `shellAutoApprove`.

**Non-Goals:**
- End-to-end tests that run a real backend server (outside Playwright's mock-API scope).
- Testing the per-task toggle beyond confirming post-seeding independence.
- Performance or load tests.

## Decisions

**DT-1 — No new test files:** All tests fit naturally into existing files (`workspace-handlers.test.ts`, `handlers.test.ts`, `workspace-settings.spec.ts`). A dedicated file would fragment coverage without benefit.

**DT-2 — `extraYaml` injection for workspace config variation:** `setupTestConfig(extraYaml, gitDir)` already supports injecting arbitrary workspace YAML lines. Tests for TC-SA-2 and TC-SA-3 use `setupTestConfig("shell_auto_approve: true", gitDir)` / `setupTestConfig("shell_auto_approve: false", gitDir)` in a nested `describe` block with its own `beforeEach`/`afterEach` — avoiding mutation of the outer suite's config state.

**DT-3 — `makeWorkspace` default `shellAutoApprove: false`:** Adding the field to the factory (one line) prevents TypeScript compile errors across all existing Playwright tests when `WorkspaceConfig` is extended. This is a defensive change, not a behavioral one.

**DT-4 — Playwright uses `api.capture` for save-payload assertions:** Consistent with the pattern already used in `W-2`, `W-5`, `W-6` — `api.capture("workspace.update", {})` returns a live array that is asserted after the user interaction.

## Risks / Trade-offs

- **Test isolation:** The nested `beforeEach` in `handlers.test.ts` must call `configCleanup()` then reassign it for the workspace-seeding tests. This is a known pattern in the suite (e.g., model-seeding tests follow the same approach) — low risk.
- **No UI component test:** `SetupView.vue` toggle wiring is only covered by Playwright, not a Vitest component test. Given that `SetupView` has no dedicated Vitest coverage today and Playwright already covers save/load patterns for it, this is acceptable.
