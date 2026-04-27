## Context

The `fix-column-prompt-chat-ux` feature changes behavior in three places that are exercised very differently by the current test harnesses:

1. Backend transition persistence and execution wiring, which already have an in-memory SQLite harness and dependency-injected executor seams.
2. Frontend prompt/transition formatting logic, where the repo currently uses Vitest for stores and pure utilities but does not have a dedicated Vue component mounting harness.
3. Task-chat UI behavior, where the strongest existing verification path is Playwright using mocked API/WebSocket fixtures.

Because of that shape, a good test suite for the feature should not force all verification through a single layer. The change needs an explicit coverage strategy that matches the seams already present in the codebase instead of introducing alternate test-only code paths.

## Goals / Non-Goals

**Goals:**
- Define a layered automated test strategy for the column prompt chat UX feature.
- Keep backend coverage close to real persistence behavior using the in-memory DB harness and dependency injection.
- Keep frontend unit coverage focused on extracted or reused pure helpers rather than introducing a new component-test framework.
- Add Playwright coverage for the user-visible transition card behavior, including legacy/new history coexistence.
- Encourage mocks through injected dependencies and fixture composition rather than alternate runtime branches.

**Non-Goals:**
- Introduce a new UI component testing stack such as Vue Test Utils or jsdom setup in this change.
- Replace existing broad backend or Playwright suites outside the feature’s coverage needs.
- Specify exact implementation details for the production feature beyond what is necessary to make it testable.

## Decisions

### 1. Coverage will be split across unit, integration, and Playwright layers

**Decision:** The test suite will explicitly divide responsibilities across pure frontend/helper tests, in-memory backend integration tests, and Playwright UI tests.

**Why:** No single test layer currently gives both confidence and maintainability for this feature. Backend state contracts, timeline composition, and user-visible disclosure UX are different concerns and should be proven where they are cheapest and most reliable to verify.

**Alternatives considered:**
- **Playwright-only coverage:** rejected because it leaves backend metadata and execution contracts under-specified and makes failures harder to localize.
- **Backend-only + utility-only coverage:** rejected because the user-visible transition-card UX still needs end-to-end validation.

### 2. Backend tests will target DI seams first, orchestrator second

**Decision:** New backend coverage should prefer focused tests around `TransitionExecutor` and other dependency-injected seams, with a smaller number of orchestrator-level integration tests for end-to-end persistence expectations.

**Why:** `TransitionExecutor` already accepts injected collaborators such as `EngineRegistry`, `ExecutionParamsBuilder`, `WorkingDirectoryResolver`, and `StreamProcessor`. That makes it the cleanest place to validate prompted transition metadata and execution wiring without introducing fake alternate code paths.

**Alternatives considered:**
- **Only test via `Orchestrator`:** rejected because it is broader than necessary for many cases and makes metadata/debugging failures harder to isolate.
- **Introduce test-only hooks in production code:** rejected because the repo already has better DI seams available.

### 3. Frontend unit coverage will stay pure-logic only

**Decision:** Frontend unit coverage for this feature should target pure helpers such as transition-summary formatting, metadata normalization, and prompt-chip segmentation reuse. It should not depend on mounted Vue component tests.

**Why:** The current frontend Vitest setup covers `src/mainview/**/*.test.ts` but does not include a DOM/component harness. Extracting small pure helpers keeps the feature testable while preserving the current testing conventions.

**Alternatives considered:**
- **Add Vue Test Utils in this test change:** rejected because it would enlarge scope and create a new testing pattern unrelated to the feature contract itself.
- **Skip frontend unit tests entirely:** rejected because some logic is cheap and valuable to verify below Playwright.

### 4. Playwright will be the source of truth for the transition card UX

**Decision:** The transition card’s collapsed summary, disclosure behavior, instruction rendering, and legacy/new history coexistence will be covered in existing task-chat-focused Playwright suites.

**Why:** Those behaviors are timeline- and interaction-sensitive, and the repo already uses `e2e/ui/conversation-body.spec.ts`, `task-drawer.spec.ts`, and shared fixtures for exactly this kind of UI verification.

**Alternatives considered:**
- **Create a brand-new dedicated Playwright file:** possible, but lower priority than extending the closest existing suites unless organization becomes unwieldy.

## Risks / Trade-offs

- **[Overlapping coverage risk]** The same scenario could be asserted in multiple layers with little extra value. → **Mitigation:** give each layer a clear job: metadata/wiring in backend tests, pure transforms in Vitest, behavior/interaction in Playwright.
- **[Fixture drift risk]** Playwright mocks may diverge from the enriched `transition_event` shape. → **Mitigation:** centralize transition-event fixture builders in shared mock-data helpers.
- **[Refactor pressure risk]** Some frontend unit coverage may require extracting helpers from existing components. → **Mitigation:** treat helper extraction as part of production cleanup, not as test-only indirection.
- **[Legacy compatibility risk]** New tests may accidentally only cover the new transition-card shape. → **Mitigation:** include explicit mixed-history cases covering legacy prompt-row conversations.

## Migration Plan

1. Add or update spec requirements defining the required coverage layers and scenarios.
2. Add backend integration tests around transition persistence and execution wiring using the in-memory DB harness and injected collaborators.
3. Add frontend pure-helper tests for transition metadata/formatting and prompt-like chip segmentation reuse.
4. Extend Playwright chat/timeline suites with structured transition-card and legacy/new coexistence scenarios.
5. Rollback path: remove the new test files and spec deltas if the feature implementation changes direction before apply starts.

## Open Questions

- None for proposal readiness. The remaining choices are implementation placement details inside the existing test directories.
