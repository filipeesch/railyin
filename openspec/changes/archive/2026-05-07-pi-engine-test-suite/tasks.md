## 1. Test Infrastructure

- [ ] 1.1 Create `src/bun/test/support/pi-sdk-mock.ts` — `MockPiSession` (queueTurn with emit/callTool/waitAbort steps) and `MockPiSdkAdapter` (queueCreate/queueResume), mirroring `copilot-sdk-mock.ts` pattern
- [ ] 1.2 Verify `PiSdkAdapter` interface is exported from `src/bun/engine/pi/session-manager.ts` (required DI seam for mock injection)
- [ ] 1.3 Verify `HarnessContext` interface is exported and injectable into `EventTranslator` constructor

## 2. Unit Tests — Pure Logic

- [ ] 2.1 Write `src/bun/test/pi-hash-cache.test.ts` — 8 scenarios (HC-1 through HC-8): first read, dedup, hash change, write invalidation, compaction reset, post-compaction re-record, search dedup, glob invalidation via picomatch
- [ ] 2.2 Write `src/bun/test/pi-undo-stack.test.ts` — 7 scenarios (US-1 through US-7): push/operationId, peel-by-path, chained peel, undo-by-id, FIFO eviction at 50, null on missing path, pre-patch full content storage
- [ ] 2.3 Run unit tests and confirm all pass: `bun test src/bun/test/pi-hash-cache.test.ts src/bun/test/pi-undo-stack.test.ts --timeout 20000`

## 3. Filesystem Integration Tests

- [ ] 3.1 Write `src/bun/test/pi-file-tools.test.ts` — 13 scenarios (FT-1 through FT-13): read_file (header, range, size limit, cache dedup), write_file (creates file, op:XXXX), patch_file, undo_write (single + chained), delete_file undo, rename_file undo, glob (files, dirs, limit/offset)
- [ ] 3.2 Write `src/bun/test/pi-search-tools.test.ts` — 5 scenarios (ST-1 through ST-5): search_text with context_lines, files_with_matches mode, search cache dedup, write invalidation, fallback walker when rg unavailable
- [ ] 3.3 Write `src/bun/test/pi-shell-tool.test.ts` — 4 scenarios (SH-1 through SH-4): cwd=worktreePath, 8KB truncation, pipe support, 15-second timeout
- [ ] 3.4 Run filesystem integration tests: `bun test src/bun/test/pi-file-tools.test.ts src/bun/test/pi-search-tools.test.ts src/bun/test/pi-shell-tool.test.ts --timeout 20000`

## 4. Engine Integration Tests

- [ ] 4.1 Write `src/bun/test/pi-events.test.ts` — 7 scenarios (EV-1 through EV-7): text_delta→stream_text, tool_call→tool_start, tool_result→tool_end, turn_end→done, error→error, compaction_start resets hash cache seenInWindow, unknown event ignored
- [ ] 4.2 Write `src/bun/test/pi-session-manager.test.ts` — 4 scenarios (SM-1 through SM-4): create keyed by conversationId, same id returns same session, destroy removes session, independent HarnessContext per session
- [ ] 4.3 Write `src/bun/test/pi-tool-groups.test.ts` — 7 scenarios (TG-1 through TG-7): default set, ["read","search"] filter, board tools always present, unknown group ignored, valid defineTool objects, read_file NEVER clause, run_command NEVER clause
- [ ] 4.4 Write `src/bun/test/pi-rpc-scenarios.test.ts` — run `runSharedRpcScenarios` with MockPiSdkAdapter-backed BackendRpcRuntime + 3 Pi-specific flows (RPC-1: shared scenarios, RPC-2: write-then-undo file state, RPC-3: [unchanged] in stream events)
- [ ] 4.5 Run engine integration tests: `bun test src/bun/test/pi-events.test.ts src/bun/test/pi-session-manager.test.ts src/bun/test/pi-tool-groups.test.ts src/bun/test/pi-rpc-scenarios.test.ts --timeout 20000`

## 5. Playwright UI Tests

- [ ] 5.1 Add 3 scenarios to `e2e/ui/tool-rendering.spec.ts`: S-28 (undo_write result card), S-29 (op:XXXX visible in write_file result), S-30 ([unchanged] marker renders as content in read_file card)
- [ ] 5.2 Run Playwright tool-rendering suite: `bun run build && npx playwright test e2e/ui/tool-rendering.spec.ts`

## 6. Full Suite Verification

- [ ] 6.1 Run full backend test suite and confirm no regressions: `bun test src/bun/test --timeout 20000`
- [ ] 6.2 Run full Playwright suite and confirm no regressions: `bun run build && npx playwright test e2e/ui`
