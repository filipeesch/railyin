## Context

The `opencode-engine-support` change introduces three novel components that need test coverage:
1. **`event-translator.ts`** — pure functions mapping OpenCode SSE `Part` events to Railyin `EngineEvent`
2. **`attachment-mapper.ts`** — maps Railyin `Attachment[]` to OpenCode `FilePartInput[]`
3. **`OpenCodeEngine`** — implements `ExecutionEngine`, manages session lifecycle keyed by `conversationId`, and wires MCP context dispatch

The existing test infrastructure (`BackendRpcRuntime`, `shared-rpc-scenarios.ts`, `MockClaudeSdkAdapter` pattern) provides all the harness needed. No new infrastructure is required — only new mock and test files.

## Goals / Non-Goals

**Goals:**
- Unit test all `event-translator.ts` translation paths, including edge cases (unknown event types, partial data)
- Unit test `attachment-mapper.ts` for all attachment shapes
- Unit test `OpenCodeEngineConfig` validation paths in `config/index.ts`
- Integration test the full RPC lifecycle using `MockOpenCodeSdkAdapter` injected via DI
- Verify session reuse: same `conversationId` → same OpenCode session across executions
- Verify context map cleanup: execution context removed after execution ends (normal + error)
- Extend `lease-registry.test.ts` to prove `"opencode"` is accepted as a valid engine string

**Non-Goals:**
- Testing `DefaultOpenCodeSdkAdapter` against a real OpenCode server (E2E concern)
- Testing MCP HTTP registration over the network
- Playwright UI tests (no new UI surface in `opencode-engine-support`)
- Testing OpenCode SDK internals

## Decisions

### D1: Follow `MockClaudeSdkAdapter` pattern, not `MockCopilotSdkAdapter`

**Decision**: `MockOpenCodeSdkAdapter` implements `OpenCodeSdkAdapter` and its `run()` method returns `AsyncIterable<EngineEvent>` — translation already done.

**Rationale**: Claude's adapter interface operates at the `EngineEvent` level (translation is internal to the adapter). OpenCode follows the same design — `event-translator.ts` is tested separately as a pure unit. The mock only needs to script event sequences, not raw SSE payloads.

**Alternative considered**: Mock at the raw SSE level (like Copilot mocks SDK events). Rejected — would couple tests to SDK wire format, not the engine's contract.

### D2: Session lifecycle verified via `trace` fields on the mock

**Decision**: `MockOpenCodeSdkAdapter` exposes a `trace` object:
```typescript
trace: {
  createCalls: Array<{ conversationId: number; directory: string; model?: string }>
  resumeCalls: Array<{ conversationId: number; sessionId: string }>
  listModelsCalls: number
  listCommandsCalls: Array<{ directory: string }>
}
```

**Rationale**: Session lifecycle (create once, resume on subsequent executions) is a critical correctness property of the OpenCode engine. Without a trace, tests can only assert on outputs — not on whether the right session operations happened. Mirrors `MockClaudeSdkAdapter`'s `trace.createCalls` / `trace.resumeCalls`.

### D3: Context map cleanup verified via mock sentinel

**Decision**: `MockOpenCodeSdkAdapter` tracks `activeContexts: Set<number>` (conversationIds currently registered). Tests assert the set is empty after execution ends.

**Rationale**: Context map leaks would cause MCP tool calls to dispatch to the wrong execution. This is a correctness property that can only be verified through a mock that observes the context lifecycle.

### D4: Shared RPC scenarios run unmodified

**Decision**: `opencode-rpc-scenarios.test.ts` calls all functions from `shared-rpc-scenarios.ts` (single-turn, multi-turn, tool success/failure, ask_user, cancellation, fatal failure, model listing) without modification.

**Rationale**: These scenarios are engine-agnostic by design. If OpenCode passes all shared scenarios, it satisfies the `ExecutionEngine` contract. Any OpenCode-specific behaviour is tested in additional `it()` blocks in the same file.

## Mock API Design

```
MockOpenCodeSdkAdapter
  ├── queueCreate(script)    → scripts a new-session execution
  ├── queueResume(script)    → scripts a resume-session execution
  ├── setModels(models)      → models returned by listModels()
  ├── setSkills(skills)      → skills returned by listCommands()
  ├── trace                  → observable call log
  └── activeContexts         → conversationIds currently in context map

MockTurnScript
  ├── steps: Array<MockTurnStep>
  └── sendError?: Error      → optional rejection on prompt call

MockTurnStep
  ├── { kind: "emit"; event: EngineEvent }
  ├── { kind: "waitForAbort" }
  └── (no callTool — MCP tools tested via shared scenarios)
```

Event builder helpers (matching Claude/Copilot mock style):
```typescript
token(content)          → { type: "emit", event: { type: "token", content } }
reasoning(content)      → { type: "emit", event: { type: "reasoning", content } }
toolStart(id, name)     → { type: "emit", event: { type: "tool_start", ... } }
toolResult(id, name)    → { type: "emit", event: { type: "tool_result", ... } }
done()                  → { type: "emit", event: { type: "done" } }
usage(in, out)          → { type: "emit", event: { type: "usage", ... } }
shellApproval(cmd)      → { type: "emit", event: { type: "shell_approval", ... } }
askUser(payload)        → { type: "emit", event: { type: "ask_user", payload } }
waitForAbort()          → { kind: "waitForAbort" }
fatal(msg)              → { type: "emit", event: { type: "error", fatal: true, message: msg } }
```

## Risks / Trade-offs

**[Risk] Mock drifts from real adapter interface** → Mitigation: `MockOpenCodeSdkAdapter implements OpenCodeSdkAdapter` — TypeScript enforces the interface. Any signature change in `types.ts` breaks compilation of the mock immediately.

**[Risk] Session lifecycle tests are timing-sensitive** → Mitigation: Use the same `waitForExecutionStatus` polling helper already used in Claude/Copilot integration tests. No `setTimeout` hacks.
