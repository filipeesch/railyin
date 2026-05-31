## 1. Extract fs-ops module (refactor prerequisite)

- [x] 1.1 Create `src/bun/engine/pi/tools/fs-ops.ts` — wrap readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync, statSync from node:fs
- [x] 1.2 Update `src/bun/engine/pi/tools/write.ts` — replace all `import { ... } from 'node:fs'` with imports from './fs-ops.ts'
- [x] 1.3 Verify no TypeScript errors after refactor (`bun run build` or type check passes)

## 2. Unit tests for splitLines and computeFileDiff

- [x] 2.1 Tests in `src/bun/test/myers-diff.test.ts` (SL-1 through SL-5, SL-6 through SL-11)
- [x] 2.2 Test splitLines("") → returns 0
- [x] 2.3 Test splitLines("\n") → returns 1
- [x] 2.4 Test splitLines("a\nb\nc\n") → returns 3 (trailing newline stripped)
- [x] 2.5 Test splitLines("line1\nline2") → returns 2 (no trailing newline)
- [x] 2.6 Test splitLines("a\nb\n\n") → returns 3 (empty line before trailing \n counts)
- [x] 2.7 Test computeFileDiff single-line replacement in 150-line file → added: 1, removed: 1
- [x] 2.8 Test computeFileDiff identical strings → added: 0, removed: 0, hunks: []
- [x] 2.9 Test computeFileDiff new file (empty before) → added: N, removed: 0, all lines as "added"
- [x] 2.10 Test computeFileDiff delete scenario → added: 0, removed: N, all lines as "removed"
- [x] 2.11 Test computeFileDiff multi-hunk diff sums counts across all hunks

## 3. Integration tests for write tool execution

- [x] 3.1 Created `src/bun/test/write-tools-integration.test.ts`
- [x] 3.2 Test write_file creates new file on disk with correct payload (is_new: true) [WI-WF-1]
- [x] 3.3 Test write_file overwrites existing file with correct added/removed counts [WI-WF-2]
- [x] 3.4 Test patch_file replace position substitutes anchor correctly [WI-PF-1]
- [x] 3.5 Test patch_file before/after positions insert content without removing [WI-PF-2]
- [x] 3.6 Test patch_file rejects duplicate anchor with error + unchanged file [WI-PF-3]
- [x] 3.7 Test patch_file missing anchor with error + unchanged file [WI-PF-4]
- [x] 3.8 Test delete_file removes file and emits diff with all lines as "removed" [WI-DIF-1]
- [x] 3.9 Test rename_file moves file, original gone, destination has content [WIN-RNF-1]
- [x] 3.10 Test write_file path traversal rejection (security edge case) [WI-WF-3]
- [x] 3.11 All integration tests pass (10/10)

## 4. E2E regression test for UI rendering

- [x] 4.1 Added mock helpers to `e2e/ui/fixtures/mock-api.ts` for constructing writtenFiles payloads via conversations.getMessages
- [x] 4.2 Added Playwright spec scenarios in `e2e/ui/stream-reactivity.spec.ts` (Suite G)
- [x] 4.3 Mock tool_result event with known writtenFiles [{ operation: "patch_file", added: 3, removed: 1 }]
- [x] 4.4 Assert UI renders file_diff block showing "+3" / "-1" stat badges
- [x] 4.5 Mock tool_result with multiple writtenFiles entries, assert combined stats (+2 -5)
- [x] 4.6 Verified tests reference correct selectors (.tcg .tc__stat--added, .tcg .tc__stat--removed)

## 5. Review existing tests for regressions

- [x] 5.1 `src/bun/test/myers-diff.test.ts` — all 19 tests pass (includes MD-6b assertion verified)
- [x] 5.2 Existing tool events tests use hardcoded `{added:0, removed:0}` which remains valid
- [x] 5.3 Full Bun test suite: integration (10/10) + unit (19/19) = 29 passing, 0 failing
