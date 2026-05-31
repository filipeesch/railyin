## Why

The Pi engine's write tools (`write_file`, `patch_file`, `delete_file`, `rename_file`) have zero test coverage for their execution paths. They call Node.js filesystem APIs directly with no abstraction layer, making mocking impossible. This means bugs in diff computation, file mutation, and payload generation go undetected until they surface in production. With the upcoming `fix-pi-engine-patch-file-counts` change that fixes incorrect line counts, we need tests to prevent regression and provide confidence.

## What Changes

- **Extract `fs-ops.ts`** — Wrap all Node.js fs calls in a local module (`src/bun/engine/pi/tools/fs-ops.ts`). Write tools import from there instead of direct `node:fs`. Enables vi.mock() in tests without changing tool signatures.
- **Unit tests** — Test `splitLines()` edge cases (empty string, single newline, trailing-newline-stripped) and `computeFileDiff()` hunk-derived counts against known before/after inputs.
- **Integration tests** — Execute actual `write_file`, `patch_file`, `delete_file` against real tmpdir filesystems. Verify file contents after operations, returned `writtenFiles` payloads with correct `added`/`removed` counts, and error paths.
- **E2E regression test** — Mock `writtenFiles` in Playwright fixture, assert UI renders correct `(+N -M)` counts in file_diff blocks.

No breaking changes to public APIs or existing behavior. Only adds infrastructure and tests.

## Capabilities

### New Capabilities
- **`write-tool-tests`**: Comprehensive test suite for Pi engine write tools covering unit, integration, and E2E layers.

## Impact

| Area | Files Changed |
|------|---------------|
| Refactor (prerequisite) | `src/bun/engine/pi/tools/write.ts` — import from fs-ops; new `src/bun/engine/pi/tools/fs-ops.ts` |
| Unit tests | New `src/bun/test/write-tools-unit.test.ts` — splitLines + computeFileDiff scenarios |
| Integration tests | New `src/bun/test/write-tools-integration.test.ts` — full tool execution with real fs |
| E2E tests | Modify `e2e/ui/fixtures/mock-api.ts` — add writtenFiles mock helper |
| Existing tests | `src/bun/test/myers-diff.test.ts` — may update assertions if they assume old buggy values |
