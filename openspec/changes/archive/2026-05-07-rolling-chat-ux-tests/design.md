## Context

The `rolling-chat-ux-improvements` change fixes 9 UX bugs and decomposes `StreamBlockNode.vue`. That change ships no automated tests — verification today is manual. The test infrastructure already exists across three layers (backend unit with Vitest, backend integration with `BackendRpcRuntime` + `ScriptedEngine`, and Playwright E2E with mock API/WebSocket), so adding coverage is a matter of extending existing files rather than building new infrastructure.

One pre-existing test (`S-18` in `stream-tree-scenarios.test.ts`) currently asserts the Bug #1 regression. It must be corrected as part of this change.

## Goals / Non-Goals

**Goals:**
- Correct S-18 to assert the fixed (not buggy) parentBlockId behavior
- Add backend unit test cases for each backend fix (Bugs 1–7) in existing test files
- Add integration test cases that verify fixes in the full streaming pipeline
- Add Playwright E2E cases that verify all 9 UX fixes render correctly in the browser

**Non-Goals:**
- Building new test infrastructure (no new test harnesses, fixtures, or runner config)
- Mutation testing (separate CI workflow already exists)
- Testing unchanged components (only code paths touched by `rolling-chat-ux-improvements`)
- Performance or load testing

## Decisions

### D-1: Extend existing test files, not create new ones

Each backend fix maps cleanly to an existing test file (`copilot-events.test.ts`, `claude-events.test.ts`, `common-tools-registration.test.ts`, `stream-tree-scenarios.test.ts`, `stream-pipeline-scenarios.test.ts`). Adding cases in-place keeps related tests co-located and avoids duplication of setup boilerplate.

### D-2: Test `isInternal` fix through `translateCopilotStream`, not directly

`isInternalCopilotEvent` is a private function with no export. Testing via the public `translateCopilotStream` surface (checking the `isInternal` field on emitted `tool_start` events) follows the existing pattern in `copilot-events.test.ts` — no DI or structural change needed.

### D-3: Use ScriptedEngine checkpoint protocol for mid-stream IPC assertions

The integration test for Bug #1 (S-12 in `stream-pipeline-scenarios.test.ts`) needs to observe IPC events before DB flush. The existing `scriptCheckpoint()` / `waitForCheckpoint()` / `proceed()` protocol from `ScriptedEngine` handles this without any new infrastructure.

### D-4: Playwright tests mock WS events directly, no real backend

All Playwright specs use `e2e/ui/fixtures/mock-api.ts` (`ApiMock`) and the WebSocket mock fixture. The UX fixes (CSS, markdown rendering, label text, ReasoningBubble state) are fully testable via injected mock events and DOM assertions. No real Bun server is needed for any E2E test in this change.

### D-5: S-18 corrected in-place, not replaced

Rather than adding a new S-20 scenario and leaving S-18 stale, the S-18 `describe` block is updated with the corrected assertions and a new `it()` description that reflects the fixed behavior. A companion scenario S-20 is added to cover the bare (no-parentCallId) tool call case separately.

## Risks / Trade-offs

- **S-18 must land in same commit as Bug #1 fix** — if applied independently it will fail CI. The test change is a dependency of the implementation change for that file. → Mitigation: document this ordering constraint explicitly in the test task description.
- **Playwright mock WS coverage is only as good as the mock** — if a real WS event shape diverges from what the mock injects, the test passes but production breaks. → Mitigation: mock payloads mirror the actual `StreamEvent` type from `rpc-types.ts`.
- **`useToolResultDisplay` composable** — if the extraction from `conversation.ts` is done as a pure function file, it's trivially unit-testable. If it stays as a Vue composable with reactive state, Vitest + `@vue/test-utils` is needed. → Mitigation: tasks specify extracting it as a pure function, which sidesteps Vue test complexity.
