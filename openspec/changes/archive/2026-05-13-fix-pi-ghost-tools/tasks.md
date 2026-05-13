## 1. Mutable CommonToolContext ref

- [x] 1.1 Add `commonCtxRefs = new Map<number, CommonToolContext>()` field to `PiEngine` (alongside `harnessContexts`)
- [x] 1.2 Add `getOrCreateCommonContext(conversationId, params)` private method: creates a new `CommonToolContext` on first call; on reuse, mutates `runtime.worktreePath`, `runtime.lspManager`, and all `workflow` callbacks in-place and returns the existing ref
- [x] 1.3 Replace the inline `commonCtx` construction in `createManagedExecution` with a call to `getOrCreateCommonContext(conversationId, params)`
- [x] 1.4 Update `shutdown()` to also remove from `commonCtxRefs` when cleaning up

## 2. Session reuse fix

- [x] 2.1 In `getOrCreateSession()` reuse path, replace `existing.agent.state.tools = tools as any` with `existing.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)])`
- [x] 2.2 Define `SDK_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"]` as a module-level constant (mirrors the creation-time allowlist)
- [x] 2.3 Extract `protected createNewSession()` from `getOrCreateSession()` for test DI

## 3. Stop rebuilding tools on session reuse

- [x] 3.1 Tools are only registered with the SDK on session creation; reuse path uses `setActiveToolsByName()` with existing closures (closures capture mutable `commonCtxRef`)
- [x] 3.2 Verified: reuse path does not rebuild tools — closures stay valid via mutable ref

## 4. Ghost tool description fix

- [x] 4.1 In `src/bun/engine/pi/tools/shell.ts`, updated `run_command` description to replace `search_text` with `grep` and `find`

## 5. Ghost reference cleanup

- [x] 5.1 In `src/bun/conversation/context.ts`, removed `["search_text", 20_000]` from `TOOL_RESULT_LIMITS`
- [x] 5.2 In `src/bun/conversation/context.ts`, removed `["find_files", 10_000]` from `TOOL_RESULT_LIMITS`
- [x] 5.3 In `src/bun/conversation/context.ts`, removed `"search_text"` from `MICRO_COMPACT_CLEARABLE_TOOLS`
- [x] 5.4 In `src/bun/conversation/context.ts`, removed `"find_files"` from `MICRO_COMPACT_CLEARABLE_TOOLS`
- [x] 5.5 In `src/bun/engine/pi/tools/display.ts`, removed the unreachable `search_text` display case
