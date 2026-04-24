## Context

Recent chat work introduced a unified conversation drawer and standalone chat sessions, but the regression suite still has major gaps. Planned suites for the task drawer and shared conversation body were never created, and API integration coverage still focuses on task-only paths while ignoring session chat and conversationId-first behavior.

The repo already has the infrastructure needed for richer integration coverage: Playwright fixtures for UI mocks and an API smoke-test harness that boots a real Bun server with the fake provider and in-memory DB.

## Goals / Non-Goals

**Goals:**
- Add the missing high-value Playwright suites for task drawer and shared conversation body behavior
- Expand session UI coverage for send/receive, turn transitions, cancellation, rename, and archive flows
- Expand API integration coverage for chat sessions and conversationId-based reads
- Reuse the existing fake provider/engine path so integration tests exercise real backend behavior without external dependencies

**Non-Goals:**
- Change production behavior
- Replace the existing UI fixture architecture
- Introduce a new dedicated test framework

## Decisions

### 1. Cover shared chat surfaces directly

**Decision:** Add dedicated suites for `task-drawer` and `conversation-body` instead of relying on incidental coverage from older chat specs.

**Rationale:** Those suites target the exact rewrite boundaries and make regressions obvious when shared chat behavior changes.

### 2. Use the fake provider in API integration tests

**Decision:** API integration tests will drive real chat flows against the running Bun server using the existing fake provider/engine setup.

**Rationale:** This exercises orchestration, persistence, and polling behavior that UI mocks cannot validate.

### 3. Keep UI and API coverage complementary

**Decision:** UI suites validate rendering and interaction contracts, while API smoke tests validate backend chat/session flows and compatibility paths.

**Rationale:** The two layers catch different regression classes and together provide better protection than expanding only one side.

## Risks / Trade-offs

- **More async chat tests can become flaky** → Mitigation: reuse existing mock helpers, wait for concrete DOM/state transitions, and keep API polling bounded.
- **Integration tests using fake streaming may need deterministic hooks** → Mitigation: rely on existing fake-provider queue helpers and server harness behavior rather than ad hoc sleeps.
- **Coverage can overlap with older specs** → Mitigation: focus the new suites on currently missing scenarios and shared-surface regression boundaries.

## Migration Plan

1. Add missing Playwright suites for task drawer and conversation body.
2. Extend session UI coverage where behavior is still underrepresented.
3. Extend API smoke tests with chat session lifecycle and real fake-engine chat flows.
4. Keep the old suites until the new coverage proves redundant.

Rollback is trivial because the change only adds or updates test artifacts.

## Open Questions

- Should API integration tests include explicit cancellation race cases immediately, or is that better left to backend unit tests once baseline session coverage lands?
