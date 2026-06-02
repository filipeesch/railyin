## 1. StubFileStateCache support class

- [ ] 1.1 Create `src/bun/test/support/stub-file-state-cache.ts` implementing `FileStateCache` with `preset(callId, content | null)` builder, `trace.deleted: string[]` and `trace.cleared: number` observation, and `reset()` helper

## 2. DefaultFileStateCache unit tests

- [ ] 2.1 Create `src/bun/test/file-state-cache.test.ts` with `mkdtempSync` fixture covering: existing file captured (FC-1), non-existent file yields null (FC-2), read failure yields null non-fatally (FC-3), two callIds are isolated (FC-5), delete removes entry (FC-3b), clear removes all entries (FC-4)

## 3. translateClaudeMessage unit tests with StubFileStateCache

- [ ] 3.1 Add `describe("FileStateCache integration with translateClaudeMessage")` block to `src/bun/test/claude-events.test.ts`
- [ ] 3.2 Write test CE-WF-1: `write` with string before-content → `added`/`removed` match actual diff
- [ ] 3.3 Write test CE-WF-2: `write` with `null` before-content → `is_new: true`, `removed === 0`
- [ ] 3.4 Write test CE-WF-3: `write` with `undefined` (no preset) → shallow fallback `{added:0, removed:0}`
- [ ] 3.5 Write test CE-EF-1: `edit` with string before-content → correct hunk diff
- [ ] 3.6 Write test CE-MF-1: `multiedit` with string before-content → correct hunk diff
- [ ] 3.7 Write test CE-DEL-1: after `tool_result` translated, `stub.trace.deleted` contains the callId

## 4. FS integration tests

- [ ] 4.1 Create `src/bun/test/claude-file-diff-integration.test.ts` with `mkdtempSync` fixture
- [ ] 4.2 Write test CFI-1: overwrite existing file → `added`/`removed` count only changed lines
- [ ] 4.3 Write test CFI-2: new file created → `is_new: true`, all lines added, `removed === 0`
- [ ] 4.4 Write test CFI-3: two sequential writes to same file → each result diffs only its own change

## 5. Verify

- [ ] 5.1 Run full backend test suite and confirm all new and existing tests pass: `bun test src/bun --timeout 20000`
