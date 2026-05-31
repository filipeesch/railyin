## 1. Extract fs-ops module (refactor prerequisite)

- [ ] 1.1 Create `src/bun/engine/pi/tools/fs-ops.ts` — wrap readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync, statSync from node:fs
- [ ] 1.2 Update `src/bun/engine/pi/tools/write.ts` — replace all `import { ... } from 'node:fs'` with imports from './fs-ops.ts'
- [ ] 1.3 Verify no TypeScript errors after refactor (`bun run build` or type check passes)

## 2. Unit tests for splitLines and computeFileDiff

- [ ] 2.1 Create `src/bun/test/write-tools-unit.test.ts`
- [ ] 2.2 Test splitLines(" → returns 0
- [ ] 2.3 Test splitLines("\n") → returns 1
- [ ] 2.4 Test splitLines("a\nb\nc\n") → returns 3 (trailing newline stripped)
- [ ] 2.5 Test splitLines("line1\nline2") → returns 2 (no trailing newline)
- [ ] 2.6 Test splitLines("a\nb\n\n") → returns 3 (empty line before trailing \n counts)
- [ ] 2.7 Test computeFileDiff single-line replacement in 150-line file → added: 1, removed: 1
- [ ] 2.8 Test computeFileDiff identical strings → added: 0, removed: 0, hunks: []
- [ ] 2.9 Test computeFileDiff new file (empty before) → added: N, removed: 0, all lines as "added"
- [ ] 2.10 Test computeFileDiff delete scenario → added: 0, removed: N, all lines as "removed"
- [ ] 2.11 Test computeFileDiff multi-hunk diff sums counts across all hunks

## 3. Integration tests for write tool execution

- [ ] 3.1 Create `src/bun/test/write-tools-integration.test.ts`
- [ ] 3.2 Test write_file creates new file on disk with correct payload (is_new: true)
- [ ] 3.3 Test write_file overwrites existing file with correct added/removed counts
- [ ] 3.4 Test patch_file replace position substitutes anchor correctly
- [ ] 3.5 Test patch_file before/after positions insert content without removing lines
- [ ] 3.6 Test patch_file rejects duplicate anchor with error + unchanged file
- [ ] 3.7 Test patch_file missing anchor with error + unchanged file
- [ ] 3.8 Test delete_file removes file and emits diff with all lines as "removed"
- [ ] 3.9 Test rename_file moves file, original gone, destination has content, payload has both paths
- [ ] 3.10 Test write_file path traversal rejection (security edge case)
- [ ] 3.11 Run full test suite — all integration tests pass

## 4. E2E regression test for UI rendering

- [ ] 4.1 Add mock helper to `e2e/ui/fixtures/mock-api.ts` for constructing writtenFiles payloads
- [ ] 4.2 Add Playwright spec scenario in `e2e/ui/stream-reactivity.spec.ts`
- [ ] 4.3 Mock tool_result event with known writtenFiles [{ operation: "patch_file", added: 3, removed: 1 }]
- [ ] 4.4 Assert UI renders file_diff block showing "3 additions, 1 deletion" or equivalent format
- [ ] 4.5 Mock tool_result with multiple writtenFiles entries, assert two separate file_diff blocks rendered
- [ ] 4.6 Verify Playwright test passes in headless mode (`bun run test:e2e`)

## 5. Update existing tests if needed

- [ ] 5.1 Review `src/bun/test/myers-diff.test.ts` MD-6b assertion — verify it still holds with new counting logic
- [ ] 5.2 Check `copilot-events.test.ts` and `claude-events.test.ts` — they use hardcoded `{added:0, removed:0}` which is fine for their context (dialect translation, not tool execution)
- [ ] 5.3 Run full Bun test suite (`bun test src/bun --timeout 20000`) — confirm no regressions from any changes
