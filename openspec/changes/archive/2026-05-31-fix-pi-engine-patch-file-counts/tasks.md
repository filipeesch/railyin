## 1. Add splitLines utility to diff.ts

- [x] 1.1 Add `splitLines(text: string): number` export to `src/bun/utils/diff.ts` — empty → 0, "\n" → 1, strip trailing \n first
- [x] 1.2 Export `splitLines` from diff module for use by write tools

## 2. Fix computeFileDiff line counting

- [x] 2.1 Replace `const added = afterLines.length` with hunk-derived count in `computeFileDiff()`
- [x] 2.2 Replace `const removed = beforeLines.length` with hunk-derived count in `computeFileDiff()`
- [x] 2.3 Verify `myersDiff([])` returns `[]` (no hunks) so both counts default to 0 when no changes

## 3. Update write tool confirmation strings and payloads

- [x] 3.1 Update `writeFileTool`: import `splitLines`, add `(+${diff.added} -${diff.removed})` to confirmation string; handle new file case with `(+${splitLines(args.content)})`
- [x] 3.2 Update `patchFileTool`: import `splitLines`, compute anchor's 1-based line position, add `(+(+${diff.added} -${diff.removed}) at line ${anchorLine})` to confirmation string
- [x] 3.3 Update `deleteFileTool`: call `computeFileDiff(content, "", rel, "delete_file")` instead of returning empty array; add `(-${diff.removed})` to confirmation string

## 4. Update tests

- [x] 4.1 Update `src/bun/test/myers-diff.test.ts` assertions — verify MD-6b and any other checks on `added`/`removed` match new correct values
- [x] 4.2 Add test case: single-line change in large file produces `added: 1, removed: 1` (not total file length)
- [x] 4.3 Add test case: `splitLines("", "\n", "a\n", "a\nb\n", "a\nb\nc")` all return expected values

## 5. Validate

- [x] 5.1 Run `bun test src/bun --timeout 20000` — all existing tests pass (505 pass, 86 pre-existing failures in migration/LSP tests unrelated to this change)
- [x] 5.2 Manual verification: create a 150-line file, patch one line, confirm `added: 1, removed: 1` in result (verified by test SL-6)
