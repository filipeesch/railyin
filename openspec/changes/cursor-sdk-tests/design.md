## Context

**Current State:**
- Railyin has 4 engine types (copilot, claude, opencode, pi), each with dedicated test files
- Test infrastructure uses shared patterns: `shared-rpc-scenarios.ts`, `backend-rpc-runtime.ts`
- Engine-specific tests follow pattern: `<engine>-sdk-mock.ts`, `<engine>-adapter.test.ts`, `<engine>-rpc-scenarios.test.ts`

**Engine Differences:**
- **Copilot/Clade**: CLI subprocess → STDIO communication
- **Cursor SDK**: In-process gRPC/Connect SDK → direct API calls
- **Testing Impact**: Cursor needs direct SDK mocking, not CLI process mocking

## Goals / Non-Goals

**Goals:**
- Create comprehensive test suite for Cursor SDK engine
- Follow existing patterns from Copilot, Claude, and Pi engines
- Reuse `shared-rpc-scenarios.ts` without modification
- Use AsyncGenerator pattern for `Run.stream()` mock

**Non-Goals:**
- Refactoring of existing test infrastructure (`shared-rpc-scenarios.ts`, `backend-rpc-runtime.ts`)
- Changes to shared test utilities
- Cross-engine test infrastructure changes

## Decisions

### 1. Mock Pattern: AsyncGenerator for Run.stream()

**Decision:** Mock `Run.stream()` as `AsyncGenerator<SDKMessage>` that yields SDKMessage events via a queue.

**Rationale:**
- Cursor SDK's `Run.stream()` returns `AsyncGenerator<SDKMessage>`
- Direct iteration with `for await (const msg of run.stream())` is the actual API
- Follows Copilot's `MockCopilotSession` pattern conceptually, but adapted for AsyncGenerator

**Alternatives Considered:**
- Promise waterfall: Less realistic, doesn't match actual iteration pattern
- Observer pattern: Not how Cursor SDK actually works (returns AsyncGenerator)

### 2. Test Organization: Group by Feature

**Decision:** All Cursor SDK tests in `src/bun/test/cursor/` directory.

**Rationale:**
- Existing engines use per-engine test files (copilot, claude, opencode)
- Cursor SDK is distinct engine type requiring its own tests
- Grouping by feature simplifies test discovery and maintenance

**Alternatives Considered:**
- Single file: Less scalable, harder to find specific tests
- Nested subdirectories: Over-Structure for first implementation

### 3. Shared Scenarios: No Refactoring Needed

**Decision:** Keep existing `shared-rpc-scenarios.ts` and `backend-rpc-runtime.ts` unchanged.

**Rationale:**
- Shared scenarios are engine-agnostic and work with any `ExecutionEngine`
- Cursor engine implements same interface as other engines
- Adding engine factory to runtime suffices for integration

**Alternatives Considered:**
- Refactoring to abstract factory: More complexity than needed
- Pipeline-based scenarios: Over-engineering for this use case

### 4. Mock SDK Types: In Test Support Directory

**Decision:** Mock types in `src/bun/test/cursor/mocks.ts` (not in engine implementation).

**Rationale:**
- Test mocks should be separate from production code
- Follows copilot/sdk-adapter pattern (`copilot-sdk-mock.ts` in test support)
- Engine implementation uses actual SDK, mocks are test-only

## Risks / Trade-offs

### Risk: AsyncGenerator Test Pattern Complexity

**Mitigation:** Follow established patterns from copilot-sdk-mock.ts. The AsyncGenerator pattern is well-documented and tested in existing code.

### Risk: gRPC/Connect SDK Differences

**Mitigation:** Mock SDK handles all SDK complexity. Test only needs to assert on SDKMessage events, not gRPC internals.

### Risk: Test Coverage Gaps Without Real SDK

**Mitigation:** Comprehensive unit tests cover event translation and state transitions. Integration tests verify end-to-end flow via shared scenarios.
