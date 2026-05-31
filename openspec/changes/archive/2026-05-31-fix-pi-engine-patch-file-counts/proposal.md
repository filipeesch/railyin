## Why

The `patch_file`, `write_file`, and `delete_file` Pi engine tools return incorrect `added`/`removed` line counts in their `WrittenFiles` data. The root cause is in `computeFileDiff()` which uses raw array lengths instead of actual diff-derived counts — a single-line change in a 500-line file reports `added: 500, removed: 500`. Additionally, `delete_file` produces no diff payload at all, and confirmation strings lack the `(+N -M)` format required by spec. This makes it impossible for the UI or LLM to understand the true scope of a file operation.

## What Changes

- **Fix `computeFileDiff()`** — Replace raw array-length counting with hunk-derived counts (count only `type === "added"` / `type === "removed"` lines across all hunks).
- **Add `splitLines()` utility** — Consistent line-counting per spec: empty string → 0, `"\n"` → 1, trailing-newline-stripped.
- **Fix `delete_file()`** — Emit real `file_diff` payload with hunks of removed lines, instead of empty `writtenFiles: []`.
- **Add confirmation strings** — All write tools show `(+(+N -M))` counts using `splitLines` for consistency.
- **Update tests** — Verify computed counts match actual changes.

No breaking changes to public APIs. The `FileDiffPayload` interface remains identical; only the values of `added`/`removed` change to be correct.

## Capabilities

### Modified Capabilities
- **`write-tools`**: Requirements around `added`/`removed` counts must now reflect actual diff changes (not total file lines). Confirmation strings must include `(+N -M)`. `splitLines` algorithm required. `delete_file` must emit file_diff message.
- **`patch-file`**: Line count semantics must use consistent `splitLines` algorithm. Anchor-based position modes must report accurate added/removed.

## Impact

| Area | Files Changed |
|------|---------------|
| Diff utilities | `src/bun/utils/diff.ts` — add `splitLines`, fix `computeFileDiff` counts |
| Write tools | `src/bun/engine/pi/tools/write.ts` — update confirmation strings, fix delete_file |
| Tests | `src/bun/test/myers-diff.test.ts` — update assertions if needed |
| Shared types | None — `FileDiffPayload` schema unchanged |
