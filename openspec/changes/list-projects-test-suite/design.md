## Context

The `list-projects-tool` change introduces several testable concerns:
1. **Tool registration** — `list_projects` must appear in `COMMON_TOOL_DEFINITIONS`, `COMMON_TOOL_NAMES`, and all engine registrations
2. **Handler execution** — calls `ctx.repos.projects.listByWorkspace(ctx.workspaceKey)`, returns formatted JSON or empty message
3. **DI injection** — `IProjectRepository` is injected into `CommonToolContext.repos.projects`, requiring mocks in all test files
4. **Auto-derived names** — `COMMON_TOOL_NAMES` and `CHILD_COMMON_TOOL_NAMES` are auto-derived, requiring verification tests

Test infrastructure is split into:
- **Unit tests** (`src/bun/test/`) — vitest, in-memory DB, mocked repos, no config
- **Integration tests** (`src/bun/test/`) — vitest + `setupTestConfig()`, real config files
- **Playwright tests** (`e2e/ui/`) — browser tests, mock API

`list_projects` is an AI-only tool — no frontend rendering changes — so Playwright tests are not required.

## Goals / Non-Goals

**Goals:**
- 100% spec scenario coverage for `list_projects` tool (registration, execution, display, engines)
- Verify DI injection works (mocked in unit tests, real in integration tests)
- Verify auto-derived `COMMON_TOOL_NAMES` and `CHILD_COMMON_TOOL_NAMES`
- Update all existing test files to include `repos.projects` mock (no TypeScript errors)
- Follow existing test patterns (no new testing frameworks or patterns)

**Non-Goals:**
- Playwright tests (not needed for AI-only tool)
- E2E tests via real API (overkill for a tool call)
- Performance/benchmark tests

## Decisions

**1. Unit tests in common-tools-registration.test.ts**
- Follows existing pattern: each tool group has its own `describe` block
- Uses mocked `repos.projects` via `vi.fn()`
- Tests registration, display, execution with various mock returns

**2. Integration tests in new workspace-tools.test.ts**
- Uses `setupTestConfig()` to create real workspace.yaml with projects
- Uses real `ConfigProjectRepository` (not mocked)
- Tests workspace scoping, multiple projects, optional fields

**3. Existing test files updated with minimal changes**
- Add `repos.projects: { listByWorkspace: vi.fn(() => []) }` to each `CommonToolContext` construction
- No behavior changes to existing tests — just satisfy TypeScript

## Risks / Trade-offs

- [Risk] Updating 5 existing test files introduces merge conflict risk. → Mitigation: Changes are additive only (new field), low conflict probability.
- [Risk] Integration tests depend on filesystem (config files). → Mitigation: `setupTestConfig()` handles cleanup; tests are isolated.

## Open Questions

None — all decisions resolved.
