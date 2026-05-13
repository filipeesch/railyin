## 1. Testability refactoring — extract createNewSession

- [x] 1.1 In `src/bun/engine/pi/engine.ts`, extract the Pi SDK `createAgentSession(...)` call into a new `protected async createNewSession(tools, systemPrompt, workingDir): Promise<AgentSession>` method
- [x] 1.2 Update `TestPiEngine` in `pi-engine.test.ts` to override `createNewSession()` instead of `getOrCreateSession()` — existing compact tests must continue to pass

## 2. MockAgentSession — grow setActiveToolsByName spy

- [x] 2.1 Add `setActiveToolsCallCount = 0` and `lastSetNames: string[] = []` fields to `MockAgentSession`
- [x] 2.2 Add `async setActiveToolsByName(names: string[]): Promise<void>` method that records the call and names

## 3. Session reuse unit tests (pi-engine.test.ts)

- [x] 3.1 Add `PE-SESSION-REUSE-1`: two executions on the same `conversationId` → `setActiveToolsByName()` is called on the second execution
- [x] 3.2 Add `PE-SESSION-REUSE-2`: `lastSetNames` on the mock includes `"read"`, `"grep"`, `"find"`, `"ls"` after session reuse
- [x] 3.3 Add `PE-SESSION-REUSE-3`: first execution creates `commonCtxRef` keyed by `conversationId` (assert via `getOrCreateCommonContext` exposed on `TestPiEngine` or via indirect side effects)
- [x] 3.4 Add `PE-SESSION-REUSE-4`: second execution with a different `worktreePath` mutates the stored `commonCtxRef.runtime.worktreePath` in-place

## 4. run_command description test (tool-registry.test.ts)

- [x] 4.1 Add test asserting that `run_command` tool description (found via `buildAllTools({ columnGroups: ["shell"] })`) does NOT contain `"search_text"`
- [x] 4.2 Add test asserting that `run_command` description contains `"grep"` or `"find"`

## 5. Context constants tests (conversation-context.test.ts — new file)

- [x] 5.1 Create `src/bun/test/conversation-context.test.ts` importing `MICRO_COMPACT_CLEARABLE_TOOLS` and `TOOL_RESULT_LIMITS` from `conversation/context.ts`
- [x] 5.2 Assert `MICRO_COMPACT_CLEARABLE_TOOLS` does not contain `"search_text"`
- [x] 5.3 Assert `MICRO_COMPACT_CLEARABLE_TOOLS` does not contain `"find_files"`
- [x] 5.4 Assert `TOOL_RESULT_LIMITS` has no entry for `"search_text"`
- [x] 5.5 Assert `TOOL_RESULT_LIMITS` has no entry for `"find_files"`

## 6. buildPiToolDisplay tests (pi-event-translator.test.ts)

- [x] 6.1 Add `ET-DISPLAY-1`: `buildPiToolDisplay("read", { file_path: "/repo/src/a.ts" }, "/repo")` → `{ label: "read", subject: "src/a.ts", contentType: "file" }`
- [x] 6.2 Add `ET-DISPLAY-2`: `buildPiToolDisplay("grep", { pattern: "myFunc" })` → `{ label: "grep", contentType: "terminal" }`
- [x] 6.3 Add `ET-DISPLAY-3`: `buildPiToolDisplay("find", { pattern: "*.ts" })` → `{ label: "find", contentType: "terminal" }`
- [x] 6.4 Add `ET-DISPLAY-4`: `buildPiToolDisplay("ls", { path: "/repo/src" }, "/repo")` → `{ label: "ls", subject: "src", contentType: "terminal" }`
- [x] 6.5 Add `ET-DISPLAY-5`: `buildPiToolDisplay("search_text", { pattern: "x" })` → falls to default (label is NOT `"search"`)

## 7. Run and verify all new tests pass

- [x] 7.1 Run `bun test src/bun/test/pi-engine.test.ts --timeout 20000` and confirm all PE-SESSION-REUSE tests pass
- [x] 7.2 Run `bun test src/bun/test/tool-registry.test.ts --timeout 20000` and confirm new run_command description tests pass
- [x] 7.3 Run `bun test src/bun/test/conversation-context.test.ts --timeout 20000` and confirm constants tests pass
- [x] 7.4 Run `bun test src/bun/test/pi-event-translator.test.ts --timeout 20000` and confirm all ET-DISPLAY tests pass
- [x] 7.5 Run full backend suite `bun test src/bun/test --timeout 20000` to confirm no regressions
