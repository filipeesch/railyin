## 1. ToolLoopDetector — new class

- [x] 1.1 Create `src/bun/engine/pi/harness/tool-loop-detector.ts` with constants `WINDOW_SIZE = 15` and `MAX_REPEAT = 3`, private `window: string[]` ring buffer, private `counts: Map<string, number>`, public `reset()` (clears both), public `record(toolName: string, args: Record<string, unknown>): boolean` (fingerprint + window eviction + count check), and private `fingerprint(name, args)` (shallow-sorted JSON)

## 2. HarnessContext — add loopDetector field

- [x] 2.1 In `src/bun/engine/pi/harness/context.ts`, add `loopDetector: ToolLoopDetector` to the `HarnessContext` interface
- [x] 2.2 In `src/bun/engine/pi/engine.ts`, update `getOrCreateHarnessContext()` to initialize `loopDetector: new ToolLoopDetector()` when creating a new context entry

## 3. Parent session wiring — createManagedExecution

- [x] 3.1 In `src/bun/engine/pi/engine.ts`, at the top of `createManagedExecution()` (after `getOrCreateHarnessContext()`), call `harnessCtx.loopDetector.reset()`
- [x] 3.2 In the same function, set `session.agent.beforeToolCall` to invoke `harnessCtx.loopDetector.record(ctx.toolCall.name, ctx.args)` and return `{ block: true, reason: "..." }` when it returns `true`, otherwise return `undefined`

## 4. Child session wiring — buildDelegateTool per-job runner

- [x] 4.1 In `src/bun/engine/pi/tools/delegate.ts`, inside the per-job `runJob` function (after `childSessionFactory(opts)` returns), instantiate `const loopDetector = new ToolLoopDetector()` and set `handle.session.agent.beforeToolCall` with the same block-and-hint logic before calling `handle.session.prompt()`
