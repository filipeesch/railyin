## Context

The Pi engine exposes four write tools (`write_file`, `patch_file`, `delete_file`, `rename_file`) backed by a shared `computeFileDiff()` function in `src/bun/utils/diff.ts`. This function uses the Myers diff algorithm to compute hunk-level diffs, but then overwrites the correct per-hunk counts with raw array lengths (`afterLines.length`, `beforeLines.length`). This causes every write tool to report incorrect `added`/`removed` values — e.g., a single-line replacement in a 500-line file reports `added: 500, removed: 500`.

Additionally, `delete_file` returns `writtenFiles: []` (no diff payload), and no write tool produces the LLM-facing confirmation string format required by spec (`"OK: wrote <path> (+N -M)"`).

The `FileDiffPayload` interface in `src/shared/rpc-types.ts` is correct; only the computed values are wrong. No schema changes needed.

## Goals / Non-Goals

**Goals:**
- Fix `computeFileDiff()` to derive `added`/`removed` from actual diff hunks, not raw array lengths.
- Add `splitLines()` utility for consistent line counting per spec semantics.
- Make all four write tools emit correct `file_diff` payloads and confirmation strings.
- Preserve backward compatibility — `FileDiffPayload` shape unchanged.

**Non-Goals:**
- Refactoring the Myers diff algorithm itself (it already works correctly).
- Changing the frontend rendering of file diffs.
- Adding new tools or changing tool signatures.
- Implementing `splitLines` usage beyond write tool confirmation strings in this change.

## Decisions

### Decision 1: Count `added`/`removed` from hunk results, not input strings

```typescript
// Before
const added = afterLines.length;     // Total lines in file — WRONG
const removed = beforeLines.length;  // Total lines in file — WRONG

// After  
const added = hunks.reduce((sum, h) =>
  sum + h.lines.filter(l => l.type === "added").length, 0);
const removed = hunks.reduce((sum, h) =>
  sum + h.lines.filter(l => l.type === "removed").length, 0);
```

**Rationale**: The Myers diff already produces correct per-line classifications (`context`, `added`, `removed`). Deriving counts from the hunks means we count exactly what changed, regardless of file size or content structure. This handles all cases uniformly: normal edits, new files, deletions, and anchor-based patches.

**Alternatives considered**:
- Pass semantic "what was added/removed" from each call site → loses abstraction, more fragile.
- Post-process before/after strings to determine changed regions → duplicates hunk logic.

### Decision 2: Use a single `splitLines()` utility shared across all write tools

```typescript
export function splitLines(text: string): number {
  if (text === "") return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}
```

**Rationale**: The spec mandates this exact algorithm. A shared utility prevents drift between how `write_file`, `patch_file`, and confirmation strings count lines. All callers use `splitLines(content)` for their own contribution line count.

**Alternatives considered**:
- Inline line counting at each call site → inconsistent implementations likely.
- Compute inside `computeFileDiff` only → confirmation strings would still need separate logic.

### Decision 3: `delete_file` calls `computeFileDiff(content, "", path, "delete_file")`

**Rationale**: Passing the deleted file content as `before` and empty string as `after` makes the Myers algorithm produce hunks where every line is `type: "removed"` — exactly what the spec requires. One shared function call instead of duplicated logic.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Existing tests assert on `added`/`removed` values that were previously wrong | Tests use `toBeGreaterThan(0)` or check hunk line types directly; updated to assert exact expected counts |
| `splitLines` edge case on `"\n"` vs `"\\n"` confusion | Spec-defined algorithm is explicit; one canonical implementation eliminates ambiguity |
| Confirmation string format change could affect LLM parsing | Format matches spec examples exactly; confirms previous intent, fixes execution |
