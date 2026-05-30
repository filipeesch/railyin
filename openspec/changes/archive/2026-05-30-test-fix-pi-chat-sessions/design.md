## Context

The `fix-pi-chat-sessions` change modifies `ChatExecutor` in two ways: injecting new constructor dependencies (`ModelSettingsRepository`, `IBoardToolExecutor`, `onNewMessage`) and adding a pre-flight guard that emits an error message and returns early when Pi's context window is unconfigured. Without automated tests, these paths are invisible to CI — matching how the original bug went undetected.

Existing test infrastructure in `src/bun/test/` already covers sibling executors (`human-turn-executor.test.ts`, `transition-executor.test.ts`) and provides reusable fixtures (`initDb()`, `makeTestRegistry()`, `setupTestConfig()`). Playwright tests in `e2e/ui/` use mock-api fixtures and WebSocket interception.

## Goals / Non-Goals

**Goals:**
- Verify `ChatExecutor` correctly injects `contextWindowOverride` and `boardTools` into `ExecutionParams`
- Verify the pre-flight guard fires only for Pi engine when context window is absent
- Verify `onNewMessage` is called exactly once with a system-type message on pre-flight failure
- Verify Claude (and other non-Pi engines) are unaffected by the pre-flight guard
- Use dependency injection exclusively for all mocks — no conditional production-code paths added for testability

**Non-Goals:**
- Testing `PiEngine.buildModel()` internals (covered by Pi engine unit tests)
- Testing `ModelSettingsRepository` SQL queries (covered by its own test suite)
- Full end-to-end smoke tests with a live Pi API

## Decisions

### Unit tests use constructor injection only

All collaborators (`ModelSettingsRepository`, `IBoardToolExecutor`, `onNewMessage`, `StreamProcessor`) are injected via constructor. Tests supply fakes/stubs at construction time. No `vi.mock()` module patching, no alternative code paths in production code.

`NullModelSettingsRepository` and `SqliteModelSettingsRepository` already exist — no new stubs needed for model settings. A captured `onNewMessage` spy (simple `let captured: ConversationMessage | null`) is the minimal test double for the callback.

**Alternative considered:** Module-level mocking via `vi.mock()`. Rejected — violates the DI-only constraint and creates coupling between test setup order and module load order.

### `seedChatSession()` is additive in `helpers.ts`

All integration tests that need a `chat_sessions` row use a new `seedChatSession(db, overrides?)` helper. This is purely additive — existing helper functions (`seedTask`, `seedExecution`, etc.) are untouched.

**Why a helper vs. raw SQL in each test:** Consistency with the existing `seedTask()` / `seedExecution()` pattern; keeps test bodies focused on assertions.

### `StubStreamProcessor` intercepts execution without network calls

The `StubStreamProcessor` (already used in `human-turn-executor.test.ts` / `transition-executor.test.ts`) is reused to assert whether execution was started or skipped. Checking `stubStream.lastRun === null` confirms the pre-flight early-return path; checking `stubStream.lastRun !== null` confirms the happy path proceeded to execution.

### Playwright tests extend existing mock-api fixture

`e2e/ui/fixtures/mock-api.ts` already has `makeChatMessage()` which accepts `overrides: { type, role }`. The two new Playwright specs (Pi error rendering, Claude unaffected) extend mock-api with a `piErrorSession` helper that injects a pre-seeded system message — no changes to production mock-api fixture needed.

## Risks / Trade-offs

- **Risk: `seedChatSession()` schema drift** — If the `chat_sessions` table schema changes, `seedChatSession()` silently inserts bad rows. Mitigation: keep the helper minimal, inserting only required columns, and let DB constraints surface mismatches early.
- **Risk: Playwright flakiness on system message rendering** — Timing of WebSocket `message.new` delivery is non-deterministic in mock mode. Mitigation: assert on element visibility with Playwright's `waitFor`, not on render timing.
- **Trade-off: no live Pi API test** — Full round-trip validation requires a real Pi deployment. Accepted — the pre-flight guard and param injection are verifiable without a live engine.
