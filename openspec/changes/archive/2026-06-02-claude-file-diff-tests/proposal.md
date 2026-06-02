## Why

The `claude-accurate-file-diffs` change introduces `FileStateCache` and moves diff computation into `events.ts`, but ships with no dedicated test coverage for the new logic. Given the subtleties explored during design (algebraic reconstruction failure modes, sequential multi-write safety, new-file null semantics, fallback on capture failure), deliberate test coverage is required before implementation begins.

## What Changes

- Add `StubFileStateCache` to `src/bun/test/support/` — a reusable test double implementing the `FileStateCache` interface with builder-pattern pre-loading and a `trace` record for side-effect assertions.
- Add `src/bun/test/file-state-cache.test.ts` — unit tests for `DefaultFileStateCache` using a real temp directory.
- Extend `src/bun/test/claude-events.test.ts` with a new test group covering `translateClaudeMessage` with an injected `StubFileStateCache` for all write-tool paths.
- Add `src/bun/test/claude-file-diff-integration.test.ts` — FS integration tests that drive the full `capture → tool-executes → translateClaudeMessage` flow with real files.

## Capabilities

### New Capabilities
- `stub-file-state-cache`: A reusable `StubFileStateCache` test double that implements `FileStateCache` with preset control, a `trace` record, and a `reset()` helper — intended for use across any test that exercises `translateClaudeMessage` or code that depends on `FileStateCache`.

### Modified Capabilities
- `claude-file-state-cache`: Test coverage for `DefaultFileStateCache` is added: existing file capture, new file (null), read-failure fallback, clear, callId isolation.
- `tool-result-file-changes`: Test coverage for accurate hunk emission is added: write/edit/multiedit paths, new-file is_new flag, sequential multi-write safety, undefined-fallback when cache not populated.

## Impact

- `src/bun/test/support/stub-file-state-cache.ts` — new file.
- `src/bun/test/file-state-cache.test.ts` — new file, uses `mkdtempSync`.
- `src/bun/test/claude-events.test.ts` — extended with new `describe` block; no changes to existing tests.
- `src/bun/test/claude-file-diff-integration.test.ts` — new file, uses `mkdtempSync`.
- No production code changes; no frontend changes; no API contract changes.
