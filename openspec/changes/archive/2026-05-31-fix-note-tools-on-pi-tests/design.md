# Design: fix-note-tools-on-pi-tests

## Context

The `fix-note-tools-on-pi` change introduces:
1. `buildToolAllowlist(tools)` helper in `pi/constants.ts`
2. Fixes the `defaultSessionFactory` allowlist to include note tool names
3. Updates `update_note` to reject empty content

Zero execution tests currently exist for note tools. The test suite must cover three layers:
- **Repository layer**: `NoteRepository` CRUD via in-memory SQLite
- **Dispatch layer**: `executeCommonTool` routing all note tool branches, including validation
- **Integration layer**: `buildToolAllowlist` unit tests + Pi SDK session allowlist assertions

## Goals

- Lock in note tool behavior through regression-proof tests
- Validate `buildToolAllowlist` helper returns the correct union set
- Prove Pi SDK session correctly exposes note tool names in both session-creation and session-reuse paths
- Validate all validation paths (`create_note` empty content, `update_note` empty content)

## Non-Goals

- Frontend test coverage for note rendering (separate concern)
- E2E Playwright tests for note tools (separate phase)
- Mutation testing configuration changes

## Design Decisions

### Decision 1: All tests use dependency injection, no mocks

**Rationale**: The codebase already uses this pattern throughout. `NoteRepository(db)` accepts an injected `Database`. `buildCommonTools` already accepts an injectable `executor`. `initDb()` creates the full schema including `task_notes`. Using real in-memory DB is faster, more reliable, and tests real SQL behavior.

**Consequence**: No sinon/vi.mock infrastructure needed. Tests are short and explicit.

### Decision 2: Pi SDK tests use the faux provider, not mocks

**Rationale**: `pi-session-tools-integration.test.ts` already uses `registerFauxProvider` + `fauxAssistantMessage` pattern. The faux provider produces real SDK sessions without network calls. This verifies the actual Pi SDK allowlist behavior — not a simulated version of it.

**Consequence**: Tests are slightly longer but verify the real SDK path. `buildToolAllowlist` unit tests run in the same file as structural assertions (4 tests, no new file needed).

### Decision 3: `buildToolAllowlist` tests live in `pi-session-tools-integration.test.ts`

**Rationale**: The file already imports `SDK_BUILTIN_TOOL_NAMES`. Adding a `describe('buildToolAllowlist')` block requires no new imports or setup. 4 tests don't warrant a dedicated file.

### Decision 4: Note tool dispatch tests live in a new `note-tools.test.ts`

**Rationale**: Note-tool dispatch tests are self-contained and unrelated to Pi-session concerns. A dedicated file keeps `pi-common-tools-bridge.test.ts` focused on delegation and bridge wiring, not tool-specific behavior.

## Test Layer Map

```
Layer                       File                                     Tests
─────────────────────────── ──────────────────────────────────────── ──────
NoteRepository CRUD         note-repository.test.ts (new)           NR-1..8
executeCommonTool dispatch  note-tools.test.ts (new)                CNT-1..4,LNT-1..4,UNT-1..4
Tool definition structure   common-tools-registration.test.ts (ext) CTR-N1..4
buildToolAllowlist unit     pi-session-tools-integration.test.ts    BTL-1..4
Pi SDK allowlist (session)  pi-session-tools-integration.test.ts    IT-NOTE-1..3
```

## Risks

- **Faux provider version drift**: If the Pi SDK faux provider API changes, IT-NOTE tests may need updates. Low risk — the faux provider is stable and already used in the same file.
- **Schema drift**: If `task_notes` columns change, NoteRepository tests will catch it immediately via `initDb()`.
