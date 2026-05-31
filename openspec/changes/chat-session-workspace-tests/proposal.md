## Why

The `workspace-scoped-chat-sessions` feature (change ID) implements workspace isolation for chat sessions at the database and frontend store level. Without tests, there is no regression guard — a future change could break the workspace filtering or reintroduce cross-workspace session leakage. This test suite ensures the behavior specified in the delta spec is actually exercised by automated checks.

## What Changes

Adds three layers of test coverage:
1. **Unit tests** (Vitest): Workspace → Chat store interaction, orphan cleanup on switch
2. **Integration tests** (Vitest + in-memory SQLite): Multi-workspace isolation at handler level
3. **Playwright E2E** (`chat-workspace-scoping.spec.ts`): Full UI flow for workspace switching with chat sessions

No production code changes. All changes are under `test/`, `e2e/ui/`, and openspec specs.

## Capabilities

No new capabilities or requirement changes beyond what the feature change already defined.
This is a test-only change that adds automated coverage for existing behaviors.
- `chat-session`: Delta spec extends the existing requirement with workspace-switch reload behavior, orphan cleanup, and multi-workspace isolation scenarios

## Impact

| Area | Files Changed |
|------|---------------|
| Unit tests | `src/mainview/stores/workspace.test.ts` (new WS-W suite with chatStore mock) |
| Integration tests | `src/bun/test/handlers.test.ts` (new CS-M cases appended) |
| Playwright E2E | `e2e/ui/chat-workspace-scoping.spec.ts` (new file) |
| OpenSpec spec | `openspec/changes/chat-session-workspace-tests/specs/chat-session/spec.md` (delta) |

No breaking changes. No new dependencies.
