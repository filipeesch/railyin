## 1. FileStateCache

- [ ] 1.1 Define `FileStateCache` interface in `src/bun/engine/claude/events.ts` (or a co-located `file-state-cache.ts`) with `capture`, `get`, `delete`, and `clear` methods
- [ ] 1.2 Implement `DefaultFileStateCache` using `readFileSync`/`existsSync`; store `null` when file does not exist or read fails

## 2. Wire FileStateCache through Claude engine

- [ ] 2.1 Add optional `fileStateCache?: FileStateCache` field to `ClaudeRunConfig` in `adapter.ts`
- [ ] 2.2 Create a `DefaultFileStateCache` instance per execution in `engine.ts` alongside `toolMetaByCallId`; pass it in `runConfig`
- [ ] 2.3 Add `fileStateCache` to `translateClaudeMessage` options signature in `events.ts`
- [ ] 2.4 Call `cache.clear()` in the `finally` block of `createManagedExecution` in `engine.ts`

## 3. Diff computation in events.ts

- [ ] 3.1 At `tool_use` time (assistant message) for `write`, `edit`, and `multiedit`: call `fileStateCache.capture(callId, worktreePath, filePath)`
- [ ] 3.2 Replace `extractWrittenFilesFromClaudeToolArgs` to call `computeFileDiff(before, after, path, operation)` at `tool_result` time using cached before-content and `readFileSync` for after-content
- [ ] 3.3 Handle new-file case (`before === null`) by passing `{ isNew: true }` to `computeFileDiff`
- [ ] 3.4 Handle capture-failure fallback: if `before === undefined` (not captured), fall back to shallow `{ operation, path, added: 0, removed: 0 }`
- [ ] 3.5 Call `fileStateCache.delete(callId)` after diff is computed in `tool_result` handler

## 4. Simplify stream-processor

- [ ] 4.1 Remove `beforeContentByCallId` map from `consume()` in `stream-processor.ts` (if present from any previous attempt)
- [ ] 4.2 Remove worktree DB lookup at execution start from `consume()` (if it was added solely for diff computation)
- [ ] 4.3 Simplify `_emitFileDiffFromWrittenFiles` to emit the received `FileDiffPayload` directly without performing any diff computation or file I/O

## 5. Verify

- [ ] 5.1 Run full backend test suite and confirm no regressions: `bun test src/bun --timeout 20000`

> Test coverage for this change is in the companion change **`claude-file-diff-tests`**. Implement tests from that change after completing tasks 1–4 here.
