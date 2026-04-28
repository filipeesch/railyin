## Context

The Playwright UI suite lives in `e2e/ui/` and runs against a Vite-preview-served `dist/` bundle with all network traffic intercepted by `ApiMock` and `WsMock` (in `e2e/ui/fixtures/`). There is no real Bun server involved. The current test suite has two structural problems:

1. **Helper duplication**: `openTaskDrawer`, `sendMessage`, `openSessionDrawer`, `typeInSessionEditor` are copy-pasted across `chat.spec.ts`, `extended-chat.spec.ts`, `task-drawer.spec.ts`, and `chat-session-drawer.spec.ts`. Any change to a selector or flow requires 3–4 edits.

2. **Coverage gaps**: Five distinct behavioral areas are entirely untested despite being specified in OpenSpec: toolbar action guards, session sidebar edge cases, attachment history rendering, stream state isolation, and legacy prompt-row coexistence.

All production code — `TaskChatView.vue`, `SessionChatView.vue`, `ConversationBody.vue`, `MessageBubble.vue`, the chat Pinia store — remains unchanged.

## Goals / Non-Goals

**Goals:**
- Extract shared page-interaction helpers into `e2e/ui/fixtures/helpers.ts` and re-export from `e2e/ui/fixtures/index.ts`
- Refactor the 4 existing spec files to import helpers instead of re-declaring them
- Add 5 new spec files, each covering one gap category
- All new tests use the existing `ApiMock` / `WsMock` fixture infrastructure exclusively

**Non-Goals:**
- Modifying any production frontend or backend code
- Adding new fixture fixtures (beyond `helpers.ts`)
- Changing test runner configuration (`playwright.config.ts`)
- Adding tests for surfaces not related to the task or session chat drawer

## Decisions

### D1: One spec file per gap category, not one mega-file

**Decision**: Create 5 focused spec files (`task-toolbar.spec.ts`, `session-sidebar-edge.spec.ts`, `attachment-history.spec.ts`, `conversation-stream-state.spec.ts`, `transition-card-legacy.spec.ts`) rather than expanding existing files.

**Rationale**: Each file maps to a single OpenSpec capability. Independent files can be run selectively (`npx playwright test e2e/ui/task-toolbar.spec.ts`), fail fast in isolation, and are easier to locate when a specific area regresses.

**Alternative considered**: Expand `task-drawer.spec.ts` and `chat-session-drawer.spec.ts`. Rejected because those files are already 400–800 lines; adding more suites makes navigation difficult and test-runner output harder to parse.

### D2: Shared helpers as plain async functions, not Playwright fixtures

**Decision**: Extract helpers as plain `async function openTaskDrawer(page, taskId)` exported from `helpers.ts`, not as Playwright fixture extensions.

**Rationale**: The existing helpers are already plain functions. Promoting them to fixtures would require changes to `fixtures/index.ts` type definitions and every call-site `test(...)` signature. Helpers as functions are simpler and satisfy the need without API churn.

**Alternative considered**: Playwright fixtures with `test.extend`. Rejected because the fixture context would be largely redundant with `page`, and the type-plumbing overhead is not justified here.

### D3: Toolbar visibility tests use `makeTask` overrides, not page interactions

**Decision**: Verify worktreePath-gated buttons by calling `api.handle("tasks.list", () => [makeTask({ worktreePath: "/tmp" })])` before `page.goto("/")`. Verify hidden state with `worktreePath: null`.

**Rationale**: The buttons are rendered conditionally via `v-if` in the template. There is no UI affordance to set/unset `worktreePath` at runtime. Providing tasks with/without `worktreePath` from the mock is the correct and stable approach.

### D4: Session reorder test uses `ws.pushChatSessionUpdated()`

**Decision**: To test session re-ordering, start with two sessions where session B is more recent, then push a `chat_session_updated` event for session A with a future `lastActivityAt`, and assert session A moves to the top.

**Rationale**: The chat store already sorts reactively on every `pushChatSessionUpdated` event (`sessions.value = [...sessions.value].sort(...)`). This is the minimal, deterministic path to exercise that code path in E2E.

### D5: Stream isolation test opens two tasks and verifies no cross-bleed

**Decision**: Open task A's drawer, stream text to task A (via WS), then open task B's drawer. Assert task A's content is absent from task B's conversation body.

**Rationale**: Conversation state is keyed by `conversationId`; if keying is broken, text bleeds between drawers. This test catches that regression without requiring concurrent page contexts.

## Risks / Trade-offs

- **Selector brittleness** → `.workflow-select`, `.task-detail__code-btn`, `.pi-desktop`, `.pi-replay`, `.msg--prompt` are CSS class selectors tied to component internals. Changes to component structure require updating tests. Mitigation: document selectors in a comment at the top of each file.
- **`typeInSessionEditor` relies on `.session-chat-view .chat-editor .cm-content`** — if the session editor class changes, multiple tests break. Mitigation: centralizing in `helpers.ts` means one fix propagates everywhere.
- **Legacy coexistence test** — the `msg--prompt` class only renders when `type === "user" && role === "prompt"`. If this branch is removed in a cleanup, the test becomes irrelevant. Mitigation: test asserts the class is visible, so a removal would cause the test to fail, surfacing the cleanup.
- **"Show archived" toggle** — `ChatSidebar.vue` passes `includeArchived: boolean` to `chatSessions.list` but no UI toggle is confirmed implemented. A test for this scenario is excluded from scope until the toggle is shipped.
