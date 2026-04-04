## 1. Shared Types

- [x] 1.1 Add `"file_diff"` to `MessageType` union in `src/shared/rpc-types.ts`
- [x] 1.2 Export `FileDiffPayload`, `Hunk`, and `HunkLine` types from `src/shared/rpc-types.ts`

## 2. Myers Diff Algorithm

- [x] 2.1 Implement `myersDiff(before: string[], after: string[]): Hunk[]` as a standalone function in `src/bun/workflow/tools.ts` with 3 context lines per hunk

## 3. Write Tool Executors

- [x] 3.1 Add `delete_file` tool definition to `TOOL_DEFINITIONS` array and to the `"write"` group in `TOOL_GROUPS`
- [x] 3.2 Implement `delete_file` executor: read line count before deleting, return compact string `"OK: deleted <path> (N lines)"`, return `FileDiffPayload` alongside
- [x] 3.3 Update `write_file` executor: on new file return `FileDiffPayload` with `is_new: true, added: N`; on overwrite read before-content, run Myers diff, return `FileDiffPayload` with hunks
- [x] 3.4 Update `write_file` LLM return string to include counts: `"OK: wrote <path> (+N -M)"` or `"OK: wrote <path> (+N lines)"` for new files
- [x] 3.5 Update `patch_file` executor: scan for anchor line number, derive `added`/`removed` counts from argument lengths (no diff algorithm), build a single-hunk `FileDiffPayload` with 3 context lines from file
- [x] 3.6 Update `patch_file` LLM return string to include counts and line number: `"OK: patched <path> (+N -M at line L)"` (anchor modes) or `"OK: patched <path> (+N lines)"` (start/end)
- [x] 3.7 Update `rename_file` executor to return `FileDiffPayload` with `to_path`, `added: 0`, `removed: 0`
- [x] 3.8 Change `executeTool` return type from `string` to `{ content: string; diff?: FileDiffPayload }` for write tools; read tools continue returning `string`

## 4. Engine Integration

- [x] 4.1 Add `"file_diff"` to the exclusion filter in `compactMessages` so it is never forwarded to the LLM
- [x] 4.2 Update write-tool call site in `runExecution` to emit a second `appendMessage` call with type `"file_diff"` when a `diff` payload is present
- [x] 4.3 Ensure `liveMessages` pushed to the LLM still uses only `stored` (compact string), not the diff payload

## 5. Frontend

- [ ] 5.1 Create `src/mainview/components/FileDiff.vue` — collapsed header with `path`, `+added` (green), `-removed` (red); click toggles expanded hunk view with line number gutter, green/red line backgrounds, and context lines
- [ ] 5.2 Handle `delete_file` case in `FileDiff.vue`: show count-only summary, no expand interaction
- [ ] 5.3 Handle `rename_file` case in `FileDiff.vue`: show `from → to (renamed)` summary, no expand interaction
- [ ] 5.4 Add `file_diff` branch to `MessageBubble.vue` that renders `<FileDiff :payload="parsed" />`

## 6. Tests

- [x] 6.1 Add unit tests for `myersDiff` covering: identical files, all-added, all-removed, mixed edits, context line boundaries
- [x] 6.2 Add `delete_file` tool tests: successful delete, non-existent file error, path traversal rejection
- [x] 6.3 Update existing `write_file` and `patch_file` tests to assert the new `FileDiffPayload` shape is returned alongside the content string
