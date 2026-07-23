## 1. HTTP/1.1 transport configuration

- [x] 1.1 Add `Cursor.configure({ local: { useHttp1ForAgent: true } })` call in `src/bun/engine/cursor/inprocess-adapter.ts`, at module load time (alongside the existing `setMaxListeners(0)` call), before any `Agent.create`/`Agent.resume` can occur.
- [x] 1.2 Verify `Cursor` is already imported from `@cursor/sdk` in that file (it is, via the existing `import { Agent, Cursor } from "@cursor/sdk";`) — no new import needed.

## 2. Fix translate-events.ts status bug

- [x] 2.1 In `src/bun/engine/cursor/translate-events.ts`, change the `case "status"` handler to read `message.status` instead of `message.message`, falling back to an empty string if absent.
- [x] 2.2 Check/update the `CursorSDKMessage` status-message type definition in the same file (or wherever it's declared) to reflect the real `status` field, if the type doesn't already include it.

## 3. Per-run stall watchdog

- [x] 3.1 In `src/bun/engine/cursor/inprocess-adapter.ts`, replace the `for await (const message of run.stream())` loop with a manually-driven iterator (`run.stream()[Symbol.asyncIterator]()`) so each `.next()` call can be raced against a timeout.
- [x] 3.2 Add a `stallTimeoutMs` constructor parameter to `InProcessCursorAdapter` (revised per design.md Decision 3: injectable, not a hardcoded module constant), defaulting to a real-world value (proposed: 5 minutes / `5 * 60_000`ms) — mirrors the existing `DefaultCopilotSdkAdapter` injectable `deadline` param precedent in `src/bun/engine/copilot/session.ts`.
- [x] 3.3 Implement the race: on each iteration, `Promise.race([iterator.next(), timeoutPromise])` using `this.stallTimeoutMs`; reset the timeout on every resolved SDK message (not just translated events).
- [x] 3.4 On timeout: best-effort cancel the run (`state.run?.cancel().catch(() => {})`), yield exactly one fatal `EngineEvent.error` with a message identifying it as a stall timeout, log a structured `console.error` line with `executionId`/`taskId`/`conversationId`/`agentId`, and break out of the loop.
- [x] 3.5 Ensure the watchdog does not fire once `state.aborted` is true (check the flag before treating a race timeout as a stall — an abort in progress should let the existing abort path resolve naturally rather than double-yielding an error).
- [x] 3.6 Confirm the existing post-loop `run.wait()` handling, `finally` cleanup (`finalizeRunState`), and the trailing `{ type: "done" }` sentinel logic still behave correctly when the loop exits via a stall (i.e. treat a stall exit the same way an abort exit is treated for those purposes — skip `run.wait()` and the trailing `done` sentinel, matching `state.aborted`'s existing early-break semantics).
- [x] 3.7 (Revision, Decision 3a) Add a `RunState.inFlightToolCalls: Set<string>` tracked via a new `trackToolCallLifecycle()` helper — populated on `tool_call` `status: "running"`, cleared on `"completed"`/`"error"` for the same `call_id`. Add a `toolExecutionStallTimeoutMs` constructor parameter (default 30 minutes), and select it instead of the strict `stallTimeoutMs` whenever `inFlightToolCalls` is non-empty, so a long-running tool call (e.g. a slow shell command) is no longer misjudged as an idle-wait stall.

## 4. Structured logging for the known transport error

- [x] 4.1 Add a structured `console.error` log (matching the existing `[cursor] ${JSON.stringify(...)}` pattern used for `PersistentBusyError`) wherever the stall watchdog or existing catch blocks in `inprocess-adapter.ts` observe a `ConnectError`-shaped failure, tagged with `executionId`/`taskId`/`conversationId`/`agentId` and the error's message/code where available.

## 5. Tests

- [x] 5.1 `translate-events.test.ts`: add/extend unit tests covering the `"status"` case reading `message.status` correctly for `"RUNNING"`/`"FINISHED"`/`"ERROR"`, including the empty-string fallback when `status` is absent.
- [x] 5.2 `inprocess-adapter.test.ts`: add unit tests for the stall watchdog, constructing `InProcessCursorAdapter` with a short `stallTimeoutMs` override (e.g. 30-50ms, per task 3.2's constructor injection) instead of a real 5-minute wait:
  - (a) normal completion (messages arriving faster than the threshold) is unaffected by the watchdog.
  - (b) a simulated stalled stream (fake SDK client whose `stream()` async iterator never resolves within the shortened threshold) yields exactly one fatal stall-timeout `EngineEvent.error` and does not hang the test.
  - (c) the timer resets on every SDK message — a stream emitting messages just under the threshold repeatedly never stalls.
  - (d) an abort triggered before the threshold elapses does not produce a duplicate/conflicting error event (reuse the existing hook-promise pattern from the "stops emitting events after abort" test).
  - (e) `run.cancel()` is best-effort called on stall; a rejecting `cancel()` does not prevent the fatal error yield (mirrors the existing "always cancels... even when cancel() rejects" test).
- [x] 5.3 `inprocess-adapter.test.ts`: add a test verifying `Cursor.configure` is called with `{ local: { useHttp1ForAgent: true } }` exactly once at module load, using the existing fake-SDK injection seam (`CursorSdkClient`) — extend the `CursorSdkClient` test-fake shape with a `configure` mock if not already present.
- [x] 5.4 `src/bun/test/cursor/rpc-scenarios.test.ts`: add a new integration scenario (real in-memory DB, full RPC via `createCursorRpcRuntime`/`MockCursorSdkAdapter`) — after a task reaches `execution_state === 'failed'` (via the existing `fatalError()` mock step, same as `§6.3.7b`), the user sends a follow-up message via `tasks.sendMessage` and a **new** execution starts and completes successfully end-to-end. This is distinct from the existing `§6.3.5b` (which covers resending after `waiting_user`) and closes a real, previously-uncovered gap in the exact recovery path this change exists to protect — confirmed via code reading that `human-turn-executor.ts`'s fallback-restart branch does NOT apply here (it's gated on `waiting_user`, not `failed`); the plain new-execution path at the bottom of `execute()` handles it instead, and no RPC-level guard blocks `sendMessage` on a `failed` task.
- [x] 5.5 Run the full backend suite (`bun test src/bun/test --timeout 20000`) plus the targeted Cursor engine tests to confirm no regressions in existing adapter/engine/human-turn-executor behavior (AgentBusyError retry, decision_request suspend, resume-throw fallback restart, §6.3.5b/§6.3.7/§6.3.7b).
- [x] 5.6 (Revision, Decision 3a) `inprocess-adapter.test.ts`: add unit tests for the two-tier threshold — a `tool_call` "running" message keeps the run alive past the strict idle threshold as long as the gap stays under the relaxed tool-execution threshold; the strict threshold resumes once the matching `"completed"` message clears the in-flight set; a tool call that itself hangs past the relaxed threshold still stalls.

## 6. Verification

- [ ] 6.1 Manually exercise a Cursor chat locally to confirm `status` events now populate the UI's status text (previously always blank, since the falsy `""` from `message.message` never satisfied `ConversationBody.vue`'s `v-if`). **Not performed in this session** — requires a live `CURSOR_API_KEY` and a running local instance; left for manual verification post-merge. Backend unit coverage (translate-events tests) confirms the field-read fix is correct.
- [ ] 6.2 Confirm via logs that `Cursor.configure` is invoked exactly once per process (module load), not per-run. **Not performed in this session** (requires a live running process) — verified instead at the unit level: `inprocess-adapter-sdk-config.test.ts` confirms exactly one call with the correct arguments on module import.
- [ ] 6.3 Update `openspec/specs/cursor-sdk/spec.md` (via archive) once this change is merged, so the modified/added requirements become the source of truth.

**Explicitly out of scope for this change**: Playwright coverage for the `status_chunk` → UI status-text rendering. Backend unit coverage of the `translate-events.ts` fix (task 5.1) is sufficient; per recorded decision, adding a Playwright spec for this cosmetic UI element is not warranted.

## Implementation Summary

All code and test tasks (1.1 through 5.6) are complete:
- HTTP/1.1 forcing (`Cursor.configure`), the `translate-events.ts` status fix, the per-run stall watchdog (with injectable `stallTimeoutMs`), structured `ConnectError`/stall logging, and the two-tier idle-vs-tool-execution threshold revision (Decision 3a) are all implemented in `src/bun/engine/cursor/inprocess-adapter.ts` and `src/bun/engine/cursor/translate-events.ts`.
- Full test coverage added: `translate-events.test.ts` (status fix), `inprocess-adapter.test.ts` (watchdog behaviors a–e plus two-tier threshold behaviors), `inprocess-adapter-sdk-config.test.ts` (new file — module-load `Cursor.configure` verification), and `rpc-scenarios.test.ts` (§6.3.7c — resend-after-`failed` integration scenario).
- Full suite green: backend unit/integration (`bun test src/bun/test`, 1833 pass/2 pre-existing skips), targeted Cursor suite (`bun test src/bun/engine/cursor src/bun/test/cursor`, 153 pass), API smoke tests (`bun test e2e/api`, 30 pass), and Playwright UI suite (`npx playwright test e2e/ui`, 678 pass). No regressions. No dead code introduced. Backend TypeScript compiles clean.
- Tasks 6.1/6.2 require a live running process with a real Cursor API key and are left for manual/production verification; the underlying behavior they'd confirm is already covered by unit tests. Task 6.3 (main spec sync) happens at archive time, per the OpenSpec workflow.
