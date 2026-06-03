## 1. Mock extensions — minimal agent shape refactoring

- [x] 1.1 In `src/bun/test/pi/background-compaction.test.ts`, add `beforeToolCall: undefined as any` to `MockBgSession.readonly agent` shape (alongside existing `onPayload`)
- [x] 1.2 In `src/bun/test/pi/delegate.test.ts`, add `beforeToolCall: ((ctx: any, signal?: AbortSignal) => Promise<any>) | undefined` to `MockChildSession.readonly agent` shape
- [x] 1.3 In `src/bun/test/pi/delegate.test.ts`, add optional `toolCallSequence: Array<{ name: string; args: Record<string, unknown> }>` parameter to `MockChildSession` constructor; update `prompt()` to iterate the sequence and call `this.agent.beforeToolCall?.({ toolCall: { name }, args }, undefined)` for each entry before completing

## 2. Unit tests — ToolLoopDetector algorithm

- [x] 2.1 Create `src/bun/test/pi/tool-loop-detector.test.ts` with describe block `"ToolLoopDetector"` containing tests TLD-1 through TLD-12 as specified in `specs/pi-loop-detection/spec.md`

## 3. Unit tests — HarnessContext loopDetector

- [x] 3.1 In `src/bun/test/pi-harness.test.ts`, add describe block `"HarnessContext loopDetector"` containing tests HLC-1 through HLC-3 — instantiate `PiEngine` and call `(engine as any).getOrCreateHarnessContext(conversationId, cwd)` directly

## 4. Integration tests — PiEngine loop guard wiring

- [x] 4.1 Create `src/bun/test/pi/loop-detection-engine.test.ts` following the `background-compaction.test.ts` pattern: `MockBgSession` (with `beforeToolCall` slot from task 1.1) + `StubModelSettingsRepository` + `makePiEngine` + `runExecution` helpers
- [x] 4.2 Implement tests LDE-1 through LDE-5 as specified in `specs/pi-engine/spec.md`; extend `MockBgSession.prompt()` to call `this.agent.beforeToolCall?.()` when a `toolCallSequence` is configured (same pattern as MockChildSession)

## 5. Delegate tests — child session loop guard

- [x] 5.1 In `src/bun/test/pi/delegate.test.ts`, add tests DL-15 through DL-18 using `MockChildSession` with `toolCallSequence` (from task 1.3) to simulate repeated tool calls within a child job
