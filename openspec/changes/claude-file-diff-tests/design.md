## Context

`claude-accurate-file-diffs` introduces `FileStateCache` and moves diff computation into `events.ts`. Three subtleties emerged during design exploration that make deliberate test structure important:

1. **Algebraic reconstruction is unsafe for `edit`/`multiedit`** — four identified failure modes (empty `new_str`, duplicate `new_str` occurrences, chained multiedit, `old_str` substring of `new_str`). All three tools use disk-read via cache, not reconstruction.
2. **Sequential multi-write safety** — callIds are unique per tool call; `capture()` at step N reads the post-write state from step N-1, giving correct incremental diffs.
3. **Three sentinel values from `FileStateCache.get()`** — `string` (before-content), `null` (new file, captured successfully), `undefined` (not captured / tool is not a write type).

The test infrastructure pattern already established (`toolMetaByCallId: new Map()` injected into `translateClaudeMessage`) directly supports a `StubFileStateCache` parallel pattern. The project has consistent support-class conventions (`MockClaudeSdkAdapter`, `ScriptedEngine`) with builder APIs and `trace` records instead of `vi.fn()`.

## Goals / Non-Goals

**Goals:**
- `DefaultFileStateCache` is tested in isolation with a real temp directory.
- `translateClaudeMessage` + `StubFileStateCache` covers all write-tool paths in pure memory — no filesystem.
- FS integration tests validate the full `capture → disk-write → translateClaudeMessage` flow.
- `StubFileStateCache` is reusable across any future test that exercises `FileStateCache`-dependent code.
- No production code changes to enable testing; all testability comes from existing DI structure.

**Non-Goals:**
- Testing stream-processor relay behaviour (already covered by S-10 in `stream-pipeline-scenarios.test.ts`).
- Testing the parallel same-file-edit known limitation (explicitly out of scope in design.md of parent change).
- Playwright tests (no UI rendering change).

## Decisions

### Decision 1: `StubFileStateCache` as a support class, not inline literals

**Choice:** Create `src/bun/test/support/stub-file-state-cache.ts` implementing the `FileStateCache` interface. Builder method: `preset(callId, content | null)`. Observation: `trace.deleted: string[]` and `trace.cleared: number` (incrementing counter). `reset()` helper clears both store and trace between tests. `capture()` and `clear()` are no-ops by default (no side-effects unless configured).

**Rationale:** Mirrors `MockClaudeSdkAdapter` pattern — typed, builder API, trace array for side-effect assertions without `vi.fn()`. Inline object literals would require re-specifying `get`/`delete`/`capture`/`clear` in every test case. Type-safety: implementing the real interface catches mismatches at compile time.

**Alternative considered:** Plain object literals `{ get: () => "...", delete: vi.fn(), ... }`. Simpler one-off, but verbose and inconsistent with the support/ convention established in the project.

---

### Decision 2: Three test files, each with a distinct scope

**Choice:**
- `file-state-cache.test.ts` — `DefaultFileStateCache` in isolation with `mkdtempSync`. Covers `capture`, `get`, `delete`, `clear`, callId isolation, read-failure fallback.
- `claude-events.test.ts` extended — new `describe("FileStateCache integration with translateClaudeMessage")` block. All pure in-memory. Covers the three sentinel value paths and all three tool types.
- `claude-file-diff-integration.test.ts` — real temp dir, `DefaultFileStateCache` instance, simulate tool execution via `writeFileSync`, assert final `writtenFiles` hunks.

**Rationale:** Clean separation of concerns. `file-state-cache.test.ts` tests the cache in isolation — if it fails, the cause is immediately clear without involving `translateClaudeMessage`. The extended `claude-events.test.ts` block tests the glue logic with full control over what the cache returns. The integration test validates the real end-to-end path without needing a running Claude SDK.

---

### Decision 3: Integration tests simulate tool execution with `writeFileSync` directly

**Choice:** Integration tests do not spawn a real Claude engine. Instead: (1) `cache.capture(callId, dir, path)` is called explicitly; (2) `writeFileSync` modifies the file (simulating what Claude SDK would do); (3) a synthetic `user` message with `tool_result` is fed to `translateClaudeMessage`. The `toolMetaByCallId` map is pre-populated with matching `tool_use` metadata.

**Rationale:** Avoids needing a live Claude SDK CLI or complex mock adapter. The integration boundary being tested is "cache reads correct before, disk reads correct after, diff is accurate" — not Claude SDK message routing. `MockClaudeSdkAdapter` + `makeClaudeRuntime` in `stream-pipeline-scenarios.test.ts` already covers the end-to-end routing path; these integration tests cover the diff-accuracy path.

## Risks / Trade-offs

**[Risk] `StubFileStateCache` drifts from `FileStateCache` interface** → Mitigated: class implements the interface, so TypeScript catches mismatches at compile time.

**[Risk] Integration tests use `writeFileSync` to simulate tool execution, which is not identical to how Claude SDK writes files** → Acceptable: the cache captures content before any write; after-content is always read from disk via `readFileSync`. The mechanism of the write is irrelevant to correctness.

**[Trade-off] `claude-events.test.ts` grows larger with the new block** → Acceptable: the new tests are a natural extension of the existing `tool_result` group. If the file becomes unwieldy, the new group can be split to `claude-events-file-cache.test.ts` later.
