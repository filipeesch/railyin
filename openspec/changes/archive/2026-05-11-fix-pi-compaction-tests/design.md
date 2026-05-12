## Context

The `fix-pi-compaction` feature touches four distinct layers: Pi engine, stream processor, orchestrator, and frontend store. Each layer requires a different testing approach:

- **Stream processor** — already has `ScriptedEngine` + `initDb` + `seedProjectAndTask`. A new `describe` block can use these directly.
- **Orchestrator** — integration tests use `makeTestRegistry(engine)` with DI. A `CompactableScriptedEngine` extending `ScriptedEngine` adds a stub `compact()`.
- **Frontend store** — `conversation.ts` store tests call `store.onNewMessage()` directly. The `compaction_summary` branch test follows the same pattern as existing `onNewMessage` tests.
- **Pi engine** — `PiEngine.compact()` calls `session.compact()` which invokes a real LLM. Unit testing requires a seam to inject a mock session. The minimal refactoring is changing `getOrCreateSession` from `private` to `protected`, enabling a test subclass to intercept session creation and return a mock.
- **E2E** — Suite R in `extended-chat.spec.ts` already mocks `tasks.compact` and pushes `message.new` via WebSocket. Two new tests extend this pattern.

## Goals / Non-Goals

**Goals:**
- Cover every changed code path in the `fix-pi-compaction` feature with automated tests
- Follow existing project test patterns (DI via ScriptedEngine, initDb, in-memory DB, Playwright mock-api)
- Use the `protected` seam in PiEngine for unit tests — no alternative conditional paths
- All new tests runnable with existing test commands (`bun test src/bun/test`, `bun test src/mainview/stores`, `npx playwright test e2e/ui`)

**Non-Goals:**
- Testing the Pi SDK internals (session.compact() LLM behaviour)
- Integration tests with a real local LLM
- Testing auto-compact threshold mathematics (the logic is a single inequality; test coverage belongs on the integration surface, not the formula itself)

## Decisions

### 1. `getOrCreateSession` visibility: `private` → `protected`

`PiEngine.getOrCreateSession()` is currently `private`. The `compact()` method calls it when no live session exists. To test this path without a real filesystem/LLM, a test subclass needs to override this method and inject a mock `AgentSession`.

**Decision**: Change `getOrCreateSession` from `private` to `protected` in `src/bun/engine/pi/engine.ts`.

**Rationale**: This is the minimum-viable seam that follows the project's preference for DI over conditional test paths. The change has zero runtime effect — `protected` vs `private` is a TypeScript-only constraint. Test subclasses inject a `MockAgentSession` implementing only the `compact()`, `isCompacting`, and `getContextUsage()` surface needed.

**Alternative considered**: Extract a `ISessionFactory` interface and pass it via constructor. Rejected: adds a new dependency to a class that already has 5 constructor params; over-engineering for a single test seam.

### 2. `CompactableScriptedEngine` for orchestrator tests

Orchestrator tests use `makeTestRegistry(engine)` with `ScriptedEngine`. `ScriptedEngine` has no `compact()` method. A subclass adding a stub `compact()` is cleaner than modifying `ScriptedEngine` itself.

**Decision**: Define `CompactableScriptedEngine extends ScriptedEngine` inline in `orchestrator.test.ts` with a configurable `compact()` that either resolves, throws, or records call arguments.

**Rationale**: Keeps `ScriptedEngine` focused on streaming execution. The orchestrator test file already imports `ScriptedEngine` directly — adding the subclass there is self-contained.

### 3. Mock `AgentSession` minimal interface for `pi-engine.test.ts`

The real `AgentSession` is a ~1500-line SDK class. Tests only need the `compact()`, `isCompacting`, and (optionally) `getContextUsage()` surface.

**Decision**: Define a `MockAgentSession` inline in `pi-engine.test.ts` implementing just these three members. The test subclass of `PiEngine` overrides `getOrCreateSession` to return this mock.

**Rationale**: Keeps the test file self-contained. If the SDK interface changes, only the mock needs updating.

### 4. Playwright R-24: sequential mock handler via closure counter

`api.handle()` accepts a closure, enabling stateful sequential responses without framework changes.

```ts
let callCount = 0;
api.handle("conversations.contextUsage", () =>
  callCount++ === 0
    ? { usedTokens: 115_200, maxTokens: 128_000, fraction: 0.9 }
    : { usedTokens: 25_600, maxTokens: 128_000, fraction: 0.2 }
);
```

**Decision**: Use a closure counter inside the test — no changes to `ApiMock`.

## Risks / Trade-offs

- **[Low risk] `protected` seam exposes `getOrCreateSession` to subclasses outside tests**: Only subclasses within the same package can exploit this. The method signature is internal and not exported. Acceptable.
- **[Low risk] Pi engine unit tests are brittle to SDK API changes**: `MockAgentSession` must match the SDK surface. SDK is pinned at v0.74.0; updates will surface clearly via TypeScript errors. Acceptable.
