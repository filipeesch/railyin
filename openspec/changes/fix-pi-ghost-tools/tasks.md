## 1. Mutable CommonToolContext ref

- [ ] 1.1 Add `private readonly commonCtxRefs = new Map<number, CommonToolContext>()` field to `PiEngine` (alongside `harnessContexts`)
- [ ] 1.2 Add `getOrCreateCommonContext(conversationId, params)` private method: creates a new `CommonToolContext` on first call; on reuse, mutates `runtime.worktreePath`, `runtime.lspManager`, and all `workflow` callbacks in-place and returns the existing ref
- [ ] 1.3 Replace the inline `commonCtx` construction in `createManagedExecution` with a call to `getOrCreateCommonContext(conversationId, params)`
- [ ] 1.4 Update `dispose()` to also remove from `commonCtxRefs` when cleaning up a conversation's session

## 2. Session reuse fix

- [ ] 2.1 In `getOrCreateSession()` reuse path, replace `existing.agent.state.tools = tools as any` with `existing.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)])`
- [ ] 2.2 Define `SDK_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"]` as a module-level constant (mirrors the creation-time allowlist)
- [ ] 2.3 Remove the `tools` parameter from `getOrCreateSession()` signature — on reuse the tools list is derived from `commonCtxRef` closures and the constant; on creation the tools are still built by the caller

## 3. Stop rebuilding tools on session reuse

- [ ] 3.1 Move `buildAllTools()` call inside the session-creation branch of `getOrCreateSession()` (only called on first execution for a conversation)
- [ ] 3.2 Verify session reuse path no longer calls `buildAllTools()` and no tool closures are stale (manual trace through `commonCtxRef` mutation in step 1)

## 4. Ghost tool description fix

- [ ] 4.1 In `src/bun/engine/pi/tools/shell.ts`, update the `run_command` description to replace `search_text` with `grep` and `find` (Pi SDK built-in names)

## 5. Ghost reference cleanup

- [ ] 5.1 In `src/bun/conversation/context.ts`, remove `["search_text", 20_000]` from `TOOL_RESULT_LIMITS`
- [ ] 5.2 In `src/bun/conversation/context.ts`, remove `"find_files"` from `TOOL_RESULT_LIMITS`
- [ ] 5.3 In `src/bun/conversation/context.ts`, remove `"search_text"` from `MICRO_COMPACT_CLEARABLE_TOOLS`
- [ ] 5.4 In `src/bun/conversation/context.ts`, remove `"find_files"` from `MICRO_COMPACT_CLEARABLE_TOOLS`
- [ ] 5.5 In `src/bun/engine/pi/tools/display.ts`, remove the `search_text` display case
