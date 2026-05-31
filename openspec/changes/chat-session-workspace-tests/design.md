## Context

The `workspace-scoped-chat-sessions` feature adds workspace isolation to chat sessions. The backend (migration 026 + handler filtering) and frontend store (`loadSessions(wsKey?)`) are already implemented, but there is **zero automated test coverage** for:
1. Workspace filtering at the database level
2. Cross-store interaction on workspace switch
3. End-to-end UI behavior when switching workspaces with open chat sessions

Existing tests cover basic chat session CRUD and sidebar rendering but assume a single-workspace world.

### Existing Test Infrastructure

| Layer | Framework | Pattern | Files |
|-------|-----------|---------|-------|
| Unit (stores) | Vitest + Pinia | `vi.mock()` for RPC + localStorage shim | `src/mainview/stores/*.test.ts` |
| Integration (handlers) | Vitest + bun:sqlite | In-memory DB seed → handler call → DB query assert | `src/bun/test/handlers.test.ts` |
| E2E (Playwright) | Playwright | ApiMock intercepts `/api/*`, WsMock intercepts `/ws` | `e2e/ui/*.spec.ts` |

The workspace store currently has only `workspace.test.ts` (localStorage persistence). Adding unit tests for the new cross-store dependency requires a second mock target: `../stores/chat`.

## Goals / Non-Goals

**Goals:**
- Full regression coverage for workspace-switching chat session behavior
- Tests mirror the spec scenarios exactly (one-to-one mapping)
- Follow established patterns — no new testing infrastructure or libraries
- Pass both locally (`bun test`) and in CI (including Playwright via `bun run test:e2e`)

**Non-Goals:**
- Testing the application code itself — this change only adds tests
- Fixing bugs discovered during test writing (that's a separate concern)
- Mutation testing or property-based testing
- Test performance benchmarks

## Decisions

### D1: Three-layer test strategy matching the production architecture

```
Production:    ChatStore (Pinia) ←→ Handler → SQLite DB
Testing layers:  Unit          (Vitest)   Integration    (Vitest+in-mem)  E2E (Playwright)
Scope:         State mgmt    API params        Multi-ws isolation     Full browser flow
```

Each layer tests a different boundary. This avoids duplication while providing coverage depth.

### D2: Unit tests in a dedicated file

Place new WS-W suite in `src/mainview/stores/workspace-chat.test.ts` (separate from existing `workspace.test.ts`) because:
- Existing `workspace.test.ts` uses `beforeAll(() => { globalThis.localStorage = ... })` which sets up the localStorage mock globally. Adding another `vi.mock()` for `../stores/chat` in the same file would conflict.
- A dedicated file keeps the two concerns isolated and avoids `beforeAll` / `afterAll` collisions.
- Same pattern as how `chat.test.ts` lives separately from `chat-sidebar.spec.ts`.

Mock setup follows the exact pattern proven in `task.test.ts`:

```ts
const chatMock = {
  loadSessions: vi.fn(),
  closeSession: vi.fn(),
};
vi.mock("../stores/chat", () => ({ useChatStore: () => chatMock }));
```

### D3: Integration tests appended to existing handlers.test.ts

Append CS-M cases to the existing CS-1/CS-2 section in `src/bun/test/handlers.test.ts` rather than creating a new file, because:
- The `makeHandlers()` helper and DB setup are already defined
- Chat session handler tests (CS-1 through CS-3) already exist in this file
- Following the existing convention minimizes maintenance overhead

Tests seed multiple workspaces into the in-memory SQLite DB and verify `WHERE workspace_key = ?` isolation.

### D4: Playwright tests in a dedicated spec file

New file `e2e/ui/chat-workspace-scoping.spec.ts` (Suite CS-H) because:
- The existing `chat-sidebar.spec.ts` covers CS-A through CS-G for a single workspace context. Mixing multi-workspace flows into it would bloat the file.
- Dedicated file aligns with `board-workspace-nav.spec.ts` which also covers workspace-related E2E scenarios.
- Fixture support already exists: `mock-data.makeChatSession({ workspaceKey: "ws-2" })`, workspace list mocking, localStorage seeding.

### D5: Spec delta modifies existing `chat-session` capability

The delta spec goes under `openspec/changes/chat-session-workspace-tests/specs/chat-session/spec.md` following the same approach as the feature change's own delta spec. It extends the "Workspace-level chat sessions" requirement with workspace-switch reload behavior and adds multi-workspace isolation requirements.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Vitest `vi.mock()` collision between two files importing different mocks | Each test file gets its own mock namespace. The workspace-chat.test.ts file imports nothing that conflicts with the chat.test.ts file's mocks. |
| Playwright fixture `makeChatSession()` defaults to one workspace key | Tests pass explicit `{ workspaceKey: "ws-2" }` overrides. No fixture change needed since it accepts partial overrides. |
| In-memory DB concurrent writes across workspaces might flake | Seed workspaces sequentially in beforeEach. Use transactional test data setup. Add 500ms timeout guard for async asserts. |
| E2E tests depend on workspace tab UI (may change) | Tests interact via `.workspace-tab` selectors already used by board-workspace-nav.spec.ts. If tabs change, only that file needs updating. |

## Migration Plan

No migration needed. All changes are test-only additions:
1. Run `bun test src/mainview/stores --run` for unit tests
2. Run `bun test src/bun/test --run` for integration tests  
3. Run `bun run test:e2e` for Playwright E2E (or `bun run build` first if needed)

Rollback: revert test file additions only. No production impact.

## Open Questions

None remaining. All decisions captured above.
