## Context

The Claude engine emits a shallow `FileDiffPayload` (`{ added: 0, removed: 0 }`) for `write`, `edit`, and `multiedit` tool calls. This means the chat UI shows no diff detail — or worse, accumulated `git diff HEAD` output spanning all changes since the last commit — instead of the precise lines changed by a single tool call.

The Pi engine handles this correctly: each tool handler reads the file before writing, writes it, then calls `computeFileDiff(before, after)` inline and returns the result as `details.writtenFiles`. The Claude engine has no equivalent hook because Claude executes its built-in tools externally (via the Claude SDK CLI), not through in-process handlers.

The current branch (`task/464-claude-bad-hunks`) contains a reverted attempt that placed diff computation in `stream-processor.ts`. That approach was rejected as a workaround: `stream-processor.ts` is a pure relay and should have no file I/O or diffing responsibility.

The correct layer for Claude diff computation is `src/bun/engine/claude/events.ts` — the message translator that already pairs `tool_use` (assistant message) with `tool_result` (user message) via the `toolMetaByCallId` map. This is the Claude engine's architectural equivalent of Pi's tool handlers.

## Goals / Non-Goals

**Goals:**
- Claude `write`, `edit`, and `multiedit` tool calls produce accurate per-call `FileDiffPayload` with hunk-level detail in the chat UI.
- `stream-processor.ts` contains no file I/O or diff computation; it becomes a pure relay for file diff payloads.
- The solution handles multiple writes to the same file within one execution correctly (each call diffs only its own change).
- `events.ts` remains testable without a real filesystem (achieved via a `FileStateCache` interface).

**Non-Goals:**
- Improving diff display for engines other than Claude.
- Changing frontend rendering of file diffs.
- Handling the case of two `edit` calls to the same file in a single `assistant` message (parallel batch edits to the same file — theoretically possible but never observed in practice; documented as a known limitation).

## Decisions

### Decision 1: Use `FileStateCache` interface to capture before-content

**Choice:** Introduce a `FileStateCache` interface with `capture(callId, worktreePath, filePath)`, `get(callId)`, `delete(callId)`, and `clear()`. The default implementation reads from disk via `readFileSync`. `events.ts` calls `cache.capture()` — it never imports `readFileSync` directly.

**Rationale:** Keeps `events.ts` testable. Tests inject a `StubFileStateCache` (in `src/bun/test/support/stub-file-state-cache.ts`) pre-loaded with expected before-content via a `preset(callId, content)` builder, avoiding filesystem dependencies. The interface also makes the contract explicit. This is the same reason `toolMetaByCallId` is a map passed in rather than a module-level singleton. `StubFileStateCache` follows the same support-class convention as `MockClaudeSdkAdapter`: typed interface implementation, builder API, and a `trace` record for side-effect assertions instead of `vi.fn()`.

**Alternative considered:** Read the file directly in `events.ts` (no interface). Simpler, fewer types, but makes unit testing harder — tests must set up real files on disk or mock `readFileSync`.

---

### Decision 2: `FileStateCache` lifecycle mirrors `toolMetaByCallId`

**Choice:** `FileStateCache` is created in `engine.ts` alongside `toolMetaByCallId`, threaded through `ClaudeRunConfig` as an optional field, and passed into `translateClaudeMessage` options. Entries are written at `tool_use` time and deleted after `tool_result` is processed. `clear()` is called on execution end as a safety net.

**Rationale:** `toolMetaByCallId` already solves the same problem (pairing async `tool_use`→`tool_result` across separate SDK messages). Reusing the same pattern keeps the code predictable and avoids introducing a new lifecycle pattern.

**Alternative considered:** Cache in `adapter.ts` by pre-scanning messages before calling `translateClaudeMessage`. Rejected: would duplicate message-parsing logic and blur the adapter/translator boundary.

---

### Decision 3: All three tools (write, edit, multiedit) use the cache — no algebraic reconstruction for edit

**Choice:** `edit` and `multiedit` also read before-content from disk at `tool_use` time. At `tool_result` time, `after` is read from disk (the file is already modified). Both go through `computeFileDiff(before, after)`.

**Rationale:** Algebraic reconstruction (`current.replace(new_str, old_str)`) is unsafe in three cases: (1) `new_str` is an empty string (deletion) — `"".replace("")` matches position 0; (2) `new_str` appears multiple times in the post-edit file; (3) chained `multiedit` entries that depend on each other's output. Uniform disk-read approach is always correct.

**Alternative considered:** For `edit`, reconstruct `before` from `old_str`/`new_str` in args. Rejected due to the gaps above.

---

### Decision 4: `after` is always read from disk at `tool_result` time

**Choice:** For all three tools, `after = readFileSync(path)` at `tool_result` time. The new content is not taken from `args.content` (even though it's available for `write`).

**Rationale:** Consistent approach. For `edit`/`multiedit`, the exact post-edit state on disk is the ground truth — using args would require reconstructing the full file from edits. For `write`, `args.content` and the file on disk should match, but reading disk catches any discrepancy.

## Risks / Trade-offs

**[Risk] Parallel same-file edits in one assistant message** → Not mitigated (out of scope). If Claude emits two `edit` calls targeting the same file in one `assistant` message, both `capture()` calls read the same pre-edit content. Each `tool_result` would diff `before → final-state` and produce duplicate/misleading hunks. In practice this doesn't occur — Claude doesn't batch dependent edits.

**[Risk] File read failure at `tool_use` time** → `capture()` catches exceptions and stores `null` (treat as new file). Diff computation falls back to `computeFileDiff("", after, ..., { isNew: true })`. Non-fatal; degrades to showing all lines as added rather than crashing.

**[Risk] File deleted by the tool call (e.g., a delete tool)** → Not a concern: `FileStateCache` is only activated for `write`, `edit`, and `multiedit` — not delete operations.

**[Trade-off] `events.ts` gains file I/O responsibility** → Previously a pure translator. Now has an indirect file I/O dependency via `FileStateCache`. Accepted: the interface + injection approach keeps it testable, and the Pi engine equivalent (tool handlers) also performs file I/O in the same position in the call stack.
