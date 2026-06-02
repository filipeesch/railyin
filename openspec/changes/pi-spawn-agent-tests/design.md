## Context

The `pi-engine-spawn-agent` change introduces five new production components:
- `AgentResolver` — three-tier named-agent resolution (project → user → built-in)
- `SpawnTool` (`buildSpawnTool`) — Pi tool that runs parallel child `Agent` instances
- `SpawnConfig` interface — DI carrier injected into `AllToolsOptions`
- `FakeAgent` support class — test double for Pi `Agent`
- Built-in agent files in `config/agents/`

These components have no existing coverage. The Pi engine's existing test pattern uses `BackendRpcRuntime` + a `MockPiSdkAdapter` for end-to-end flows. For spawn-specific tests a lower-level `FakeAgent` double is more appropriate — it lets tests control exactly what a child agent emits without going through the full Pi SDK session machinery.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of `AgentResolver` resolution chain and frontmatter parsing
- Full unit coverage of `SpawnTool` (named + anonymous, parallel, concurrency, events, cancel)
- Verify `buildAllTools` spawn gating (absence of `spawnConfig` = no spawn_agent for children)
- Verify `PiEngine.cancel()` bug fix (target single execution, not all sessions)
- Verify session/harnessContext map eviction on task lifecycle events
- Playwright scenarios confirming child tokens stream nested under spawn_agent card in live UI

**Non-Goals:**
- Re-testing the Pi harness file/search tools (covered by `pi-engine-test-suite` change)
- Re-testing `BackendRpcRuntime` shared RPC scenarios (covered by existing `pi-rpc-scenarios.test.ts`)
- Testing actual LLM model output quality

## Decisions

### Decision 1: FakeAgent as a plain class, not a mock framework

`FakeAgent` is a hand-written class (not `jest.fn()`, not sinon) that maintains a simple script queue. Test creates `new FakeAgent({ messages, events })`, wires it via `agentFactory` in `SpawnConfig`, and asserts on forwarded events and result strings.

**Why**: The same pattern is used by `scripted-engine.ts` for the existing engine tests. No new dependencies, no mock framework surprises, full explicitness of what the child "says".

### Decision 2: `AgentResolver` accepts injected `basePaths` array

`AgentResolver` constructor takes `basePaths: string[]` (default `[worktreePath + "/.railyin/agents", homedir + "/.railyin/agents", process.cwd() + "/config/agents"]`). Tests pass a real `tmpdir` as the only path — no filesystem mocking needed.

**Why**: Clean DI, no `fs` stubbing, tests are deterministic with real tmpdir.

### Decision 3: Playwright spec uses existing WebSocket mock infrastructure

`spawn-agent-stream.spec.ts` sends `stream.event` WS messages with `type: "text_chunk"` and `parentBlockId: "<spawnCallId>"` alongside a `tool_call` block. Asserts the token appears nested inside the spawn_agent card. Same mock pattern as `stream-reactivity.spec.ts`.

**Why**: UI tests are intentionally frontend-only (no Bun server). The frontend already handles `parentBlockId` on `text_chunk` — the test just verifies the render wiring.

### Decision 4: Cancel and session-cleanup tests share a minimal `PiEngine` fixture

Both `pi-engine-cancel.test.ts` and `pi-engine-session-cleanup.test.ts` construct a `PiEngine` with an in-memory DB and inject a `FakeAgent` via the `agentFactory` config. They do NOT use `BackendRpcRuntime` — direct engine method calls are simpler for testing narrow lifecycle behaviors.

**Why**: Fewer moving parts. Cancel and cleanup are engine-internal concerns; no need for the full RPC stack.

## Risks / Trade-offs

**Risk: FakeAgent interface drift if Pi SDK `Agent` public API changes**
→ `FakeAgent` implements the same duck-type interface used in `SpawnTool`. Adding a `// implements Agent` comment and a compile-time type assertion (`const _: Agent = new FakeAgent()`) catches drift at build time.

**Risk: Playwright spawn-agent-stream test is fragile if `blockId` generation changes**
→ Tests should assert on visual structure (token text nested inside agent card DOM element) not on exact blockId values. Use role/text selectors.

**Risk: cancel() fix test requires control over `executionId → agent` mapping**
→ Since `PiEngine` injects `agentFactory`, tests can create two `FakeAgent` instances, start two executions, then cancel one by executionId and assert only that agent received `abort()`.

## Open Questions

None — all architectural decisions resolved during design exploration.
