## 1. Test Infrastructure

- [ ] 1.1 Create `src/bun/test/support/fake-agent.ts` — `FakeAgent` class implementing Pi `Agent` duck-type interface (`subscribe`, `prompt`, `waitForIdle`, `abort`, `state.messages`, `state.errorMessage`). Supports scripted event sequences; records `aborted` flag. Add compile-time assertion `const _: AgentLike = new FakeAgent()`.

## 2. AgentResolver Unit Tests

- [ ] 2.1 Write `src/bun/test/pi-agent-resolver.test.ts` — 15 scenarios (AR-1 through AR-15) using real tmpdir for agent files. Test three-tier resolution chain, frontmatter parsing, injected `basePaths`, error messages, and built-in agent content validation.
- [ ] 2.2 Run: `bun test src/bun/test/pi-agent-resolver.test.ts --timeout 20000`

## 3. SpawnTool Unit Tests

- [ ] 3.1 Write `src/bun/test/pi-spawn-tool.test.ts` — 22 scenarios (ST-1 through ST-22). Wire `agentFactory` in `SpawnConfig` to return pre-configured `FakeAgent` instances. Cover: named agent resolution, anonymous spawn, parallel execution timing, concurrency cap, MAX_CHILDREN rejection, `isInternal`-free event forwarding with `parentCallId`, token/tool_start/tool_result event forwarding, abort propagation, result extraction, FakeAgent type assertion.
- [ ] 3.2 Run: `bun test src/bun/test/pi-spawn-tool.test.ts --timeout 20000`

## 4. Infrastructure Unit Tests

- [ ] 4.1 Write `src/bun/test/pi-build-all-tools.test.ts` — 5 scenarios (BT-1 through BT-5). Call `buildAllTools` with and without `spawnConfig`; assert spawn_agent presence/absence. No FakeAgent needed.
- [ ] 4.2 Write `src/bun/test/pi-engine-cancel.test.ts` — 4 scenarios (CE-1 through CE-4). Construct minimal `PiEngine` with in-memory DB; inject two `FakeAgent` instances via `agentFactory`. Start two executions, cancel one by ID, assert only correct agent aborted.
- [ ] 4.3 Write `src/bun/test/pi-engine-session-cleanup.test.ts` — 3 scenarios (SC-1 through SC-3). Construct `PiEngine`, start executions, trigger lifecycle hooks, assert map eviction.
- [ ] 4.4 Run: `bun test src/bun/test/pi-build-all-tools.test.ts src/bun/test/pi-engine-cancel.test.ts src/bun/test/pi-engine-session-cleanup.test.ts --timeout 20000`

## 5. Playwright UI Tests

- [ ] 5.1 Write `e2e/ui/spawn-agent-stream.spec.ts` — 5 scenarios (SAS-1 through SAS-5). Push WS `stream.event` messages with `type: "tool_call"` (toolName `spawn_agent`, blockId `spawn-1`) followed by `text_chunk` with `parentBlockId: "spawn-1"`. Assert tokens render nested inside spawn_agent card. Include reload parity scenario (SAS-5).
- [ ] 5.2 Run: `bun run build && npx playwright test e2e/ui/spawn-agent-stream.spec.ts`

## 6. Full Suite Verification

- [ ] 6.1 Run full backend suite and confirm no regressions: `bun test src/bun/test --timeout 20000`
- [ ] 6.2 Run full Playwright suite and confirm no regressions: `bun run build && npx playwright test e2e/ui`
