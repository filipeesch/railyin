## 1. Create shared translation module

- [ ] 1.1 Create `src/bun/engine/cursor/translate-events.ts` with `buildCursorToolDisplay(name, args, worktreePath)` using lowercase SDK tool names
- [ ] 1.2 Add `extractStructuredResult(result)` helper that parses shell stdout/stderr into `{ detailedResult }` and edit/write diffString into `{ writtenFiles }`
- [ ] 1.3 Move `normalizeCursorToolResult` to the shared module, updated to extract stdout from shell results
- [ ] 1.4 Move `unwrapCursorToolName` to the shared module (no changes needed)
- [ ] 1.5 Move `translateCursorMessage` to the shared module, updated to call `buildCursorToolDisplay` and `extractStructuredResult`

## 2. Update Bun-side events.ts

- [ ] 2.1 Replace all inline translation functions in `events.ts` with imports from `translate-events.ts`
- [ ] 2.2 Verify `translateCursorMessage` in `events.ts` yields `tool_start` events with `display` field
- [ ] 2.3 Verify `translateCursorMessage` in `events.ts` yields `tool_result` events with `detailedResult`, `writtenFiles`, and `display` fields

## 3. Update Node-side worker.mjs

- [ ] 3.1 Inline the shared translation functions into `worker.mjs` (keep minimal copy for Node compat)
- [ ] 3.2 Update inline `translateCursorMessage` to match the shared module's behavior (lowercase names, structured extraction)
- [ ] 3.3 Add a comment referencing `translate-events.ts` as the source of truth

## 4. Remove engine.ts fallback

- [ ] 4.1 Remove the `tool_start` display fallback block in `engine.ts._run()` (the `if (!event.display)` patch)
- [ ] 4.2 Verify that `tool_result` events no longer need any post-hoc enrichment in `_run()`

## 5. Verify correctness

- [ ] 5.1 Confirm `buildCursorToolDisplay("read", {path: "/a/b/c"}, "/a/b")` returns `{ label: "read", subject: "c", contentType: "file" }`
- [ ] 5.2 Confirm `buildCursorToolDisplay("shell", {command: "ls -la"}, "/a/b")` returns `{ label: "bash", subject: "ls -la", contentType: "terminal" }`
- [ ] 5.3 Confirm `buildCursorToolDisplay("edit", {path: "/a/b/c"}, "/a/b")` returns `{ label: "edit", subject: "c", contentType: "file" }`
- [ ] 5.4 Confirm `buildCursorToolDisplay("delete", {path: "/a/b/c"}, "/a/b")` returns `{ label: "delete", subject: "c", contentType: "file" }`
- [ ] 5.5 Confirm `extractStructuredResult({status:"success", value:{exitCode:0, stdout:"out", stderr:"err"}})` returns `{ detailedResult: "out\nerr" }`
- [ ] 5.6 Confirm `extractStructuredResult({status:"success", value:{linesAdded:1, linesRemoved:1, diffString:"--- a/f\n+++ b/f\n@@ ...\n+x\n-y\n"}})` returns `{ writtenFiles: [{ path: "f", operation: "edit_file", hunks: [...] }] }`
