## 1. Session Notes — Move Out of Stable System Block

- [x] 1.1 In `engine.ts` `assembleMessages()`, remove the `if (sessionNotes)` system message push from the system block section
- [x] 1.2 In `assembleMessages()`, inject session notes as a `<session_context>…</session_context>` block appended to the final user message content (after the conversation and triggering message are assembled)
- [x] 1.3 Update `formatSessionNotesBlock()` in `session-memory.ts` to produce the `<session_context>` XML wrapper instead of the `## Session Notes` markdown heading
- [x] 1.4 Write a test asserting that the system blocks are identical across two consecutive rounds when session notes change between them

## 2. Stable vs. Variable System Blocks in `adaptMessages()`

- [x] 2.1 In `anthropic.ts` `adaptMessages()`, verify the system join only includes stable content (stage instructions, task, worktree) — confirm session notes no longer land in `systemParts` after task 1.2
- [x] 2.2 Add a test asserting that the serialized system block string is byte-identical when the active todo list changes between rounds (todos may also shift to user-message injection if they prove to be cache-busting)

## 3. Cache Break Detection

- [x] 3.1 In `anthropic.ts`, add a `lastHashes: Map<string, { system: string; tools: string }>` module-level store keyed by execution ID (or passed as a parameter to `stream()`/`turn()`)
- [x] 3.2 Before the Anthropic HTTP request, compute `crypto.subtle.digest("SHA-256", ...)` (truncated to 8 hex chars) of the serialized system block and tool definitions
- [x] 3.3 Compare hashes against the stored value for this execution; emit `console.warn("[cache] system hash changed: ...")` or `"[cache] tools hash changed: ..."` when either differs
- [x] 3.4 Update stored hashes after each comparison
- [x] 3.5 Add a unit test that triggers a system hash change and asserts the warning is emitted

## 4. Max-Tokens Escalation

- [x] 4.1 In `anthropic.ts`, after a `stream()` call completes, inspect the final `stop_reason` from the `message_delta` SSE event
- [x] 4.2 If `stop_reason === "max_tokens"` and the original `max_tokens` was ≤ 8192, re-issue the same call with `max_tokens: 64000` and return the retry result
- [x] 4.3 Apply the same escalation logic in `turn()` for the non-streaming path
- [x] 4.4 Log the escalation: `[anthropic] max_tokens hit at <N>, retrying with 64000`
- [x] 4.5 Write a test that mocks a `stop_reason: "max_tokens"` response and verifies one retry at 64K is issued

## 5. Server-Side Context Edit Strategy (`clear_tool_uses`)

- [x] 5.1 Add `anthropic.context_edit_strategy.enabled` boolean to the workspace config schema and `getConfig()` types (default: `true`)
- [x] 5.2 In `anthropic.ts`, when building the request body, conditionally add the `anthropic-beta: context-editing-2025-10-01` header and `context_edit_strategy` body param when config is enabled
- [x] 5.3 Define the strategy constant: `trigger.input_tokens: 80000`, `keep.tool_uses: 20000`, `clear_at_least.input_tokens: 20000`
- [x] 5.4 Write a test asserting the header and body param are present when enabled and absent when `enabled: false`

## 6. Micro-Compaction for Forked Sub-Agent Context

- [x] 6.1 In `engine.ts`, confirm `compactMessages()` is called on `liveMessages` before the array is passed to a sub-agent fork (currently `compactMessages` is called on DB history — verify it also runs on the in-memory live array)
- [x] 6.2 Add `spawn_agent` to the non-clearable set in `MICRO_COMPACT_CLEARABLE_TOOLS` (its results must not be cleared — they contain agent outputs critical to orchestration)
- [x] 6.3 Write a test asserting that a forked context with >5 tool results has the oldest ones replaced with the sentinel string

## 7. Sub-Agent Full Context Fork

- [x] 7.1 In `engine.ts`, at the `spawn_agent` interception point where `runSubExecution` is called, capture the current `liveMessages` array (post-compaction) and pass it to `runSubExecution` as a `parentContext` parameter
- [x] 7.2 In `runSubExecution`, add an optional `parentContext?: AIMessage[]` parameter; when provided, use it as the base messages array and append child `instructions` as the final user message
- [x] 7.3 When `parentContext` is not provided (workflow triggers, tests), keep the existing `[system, user]` construction
- [x] 7.4 Write an integration test that spawns a sub-agent with parent context and verifies the child's first message array starts with the parent's system + prior turns

## 8. Tests and Validation

- [x] 8.1 Run the full test suite (`bun test`) and fix any regressions
- [x] 8.2 Trigger a manual execution (or replay a saved execution) and verify in logs: sub-agent first-call cache hit > 0, no `[cache] system hash changed` warning for rounds 2-10, escalation log when a sub-agent previously truncated
- [x] 8.3 Compare exec cost pre/post using `sqlite3 ~/.railyn/railyn.db "SELECT id, cost_estimate FROM executions ORDER BY id DESC LIMIT 5;"`
