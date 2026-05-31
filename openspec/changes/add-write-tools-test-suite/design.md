## Context

The Pi engine's write tools (`write_file`, `patch_file`, `delete_file`, `rename_file`) have zero test coverage for their execution paths. They directly call Node.js filesystem APIs (`readFileSync`, `writeFileSync`, etc.) inside execute methods with no abstraction layer. The existing `undo-write.test.ts` demonstrates a pattern using mkdtempSync + real fs that works but requires creating actual files on disk.

The `fix-pi-engine-patch-file-counts` change (separate proposal) fixes incorrect line counts caused by `computeFileDiff()` using raw array lengths instead of hunk-derived counts. This change creates the test infrastructure to verify correctness going forward.

## Goals / Non-Goals

**Goals:**
- Extract filesystem calls into a local `fs-ops.ts` module that can be mocked via vi.mock() without changing tool signatures.
- Unit tests for pure logic: `splitLines()` edge cases, `computeFileDiff()` hunk-derived counts against known inputs.
- Integration tests executing real tools against tmpdir directories, verifying file mutations + returned payloads.
- E2E regression test: mock `writtenFiles` in Playwright fixture, assert UI renders correct `(+N -M)` counts.

**Non-Goals:**
- Refactoring the Myers diff algorithm or its output format.
- Changing tool parameter schemas or return types.
- Testing other engines' event translators (copilot, claude, opencode).
- Full mutation testing — out of scope for now.

## Decisions

### Decision 1: Local fs-ops module vs DI interface

```
Before: import { readFileSync } from 'node:fs'
After:  import { readFileSync } from './fs-ops.ts'
```

Creating `src/bun/engine/pi/tools/fs-ops.ts` exports wrapped versions of every node:fs function used by write tools (`readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync`, `renameSync`, `mkdirSync`, `statSync`). Write tools simply change their import path — no signature changes, no dependency injection wiring. Tests use `vi.mock('../tools/fs-ops.ts')` to swap in mocks.

Alternatives considered:
- **DI FileSystem interface** — Would require adding to HarnessContext and updating every tool constructor. More flexible but unnecessary complexity for a single-file fix.
- **Direct fs in tests** — Works (like undo-write.test.ts) but prevents unit-level isolation and makes mocking error conditions hard.

### Decision 2: Separate unit and integration test files

- `src/bun/test/write-tools-unit.test.ts` — Pure functions: `splitLines()`, `computeFileDiff()` count derivation. No filesystem needed. Fast CI feedback.
- `src/bun/test/write-tools-integration.test.ts` — Tool execution against real tmpdir. Uses mkdtempSync pattern from `undo-write.test.ts`. Slower but validates the full chain.

This separation matches the codebase pattern where myers-diff.test.ts already lives as a separate file, and keeps unit tests snappy (< 100ms) while integration tests run independently.

### Decision 3: E2E test uses existing Playwright fixture pattern

Modify `e2e/ui/fixtures/mock-api.ts` to add a helper for constructing mock `writtenFiles` payloads. Add a single scenario in the existing stream-reactivity.spec.ts that asserts UI rendering of diff metadata. Low cost since the fixture infrastructure already exists.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| fs-ops refactor touches the only production import site of node:fs in write tools | Change is mechanical (import path rename) with identical behavior. One test run after refactor confirms no regressions before bug fix lands. |
| Integration tests are slower than unit tests | Test runner can parallelize; ~8-12 tests total, each taking < 500ms. Total runtime under 5 seconds. |
| Mocking fs-ops may hide real filesystem bugs | Integration tests still use real fs (no mock). Mocks are only for unit-level isolation. Both layers complement each other. |
| E2E fixture modification could affect other tests | mock-api.ts is already designed for extensibility — it accepts arbitrary overrides per test case. New helper adds an option, doesn't change defaults. |
