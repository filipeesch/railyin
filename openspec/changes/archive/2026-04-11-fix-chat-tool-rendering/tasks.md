## 1. Engine-Agnostic Contract — Backend

- [x] 1.1 In `src/bun/engine/orchestrator.ts`, update the `tool_result` case: add `tool_call_id: event.callId` to `resultMeta` alongside the existing `parent_tool_call_id`
- [x] 1.2 In `src/bun/engine/orchestrator.ts`, after persisting a `tool_result` for a write tool (write_file, edit_file, patch_file, multi_replace), run `git diff HEAD -- <path>` using the file path extracted from the paired `tool_call` content JSON; if output is non-empty, emit a `file_diff` message with `metadata: { tool_call_id: event.callId }`
- [x] 1.3 In `src/bun/workflow/engine.ts`, update the `file_diff` emission to include `tool_call_id: call.id` in the metadata passed to `appendMessage` (currently metadata is `null`)
- [x] 1.4 Verify: all `tool_result` rows now have `tool_call_id` in metadata regardless of engine path; all `file_diff` rows have `tool_call_id` in metadata

## 2. Extract and Rewrite `pairToolMessages`

- [x] 2.1 Create `src/mainview/utils/pairToolMessages.ts` — move the `ToolEntry` type here and rewrite `pairToolMessages(msgs)` using ID-based pairing:
  - Build `Map<callId, tool_result>` by parsing `tool_use_id` from each result's content JSON
  - Build `Map<callId, file_diff>` by reading `metadata.tool_call_id` from each diff message
  - For each `tool_call` in order: parse its `id` field, look up result and diff by that id, yield `{ call, result, diff, children: [] }`
  - Orphaned results/diffs (no matching call) are silently ignored
  - Unparseable `tool_call` content yields `{ call, result: null, diff: null, children: [] }`
- [x] 2.2 Update `ToolEntry` type to add `children: ToolEntry[]`
- [x] 2.3 After building the flat list, apply subagent nesting: for each entry whose `call.metadata.parent_tool_call_id` is set, find the spawn_agent entry with that call ID and move the child entry into its `children[]` array; remove it from the top-level list

## 3. Unit Tests for `pairToolMessages`

- [x] 3.1 Create `src/mainview/utils/pairToolMessages.test.ts` with test helpers that build minimal `ConversationMessage` objects
- [x] 3.2 Test: sequential (1 call, 1 result) — correct pair
- [x] 3.3 Test: batched (4 calls then 4 results) — all 4 pairs correct, using the task-32 pattern (ids 6242-6249)
- [x] 3.4 Test: batched with file_diff — each call paired with correct result and correct diff
- [x] 3.5 Test: orphaned result (no matching call) — dropped silently, no crash
- [x] 3.6 Test: orphaned call (no result) — entry with `result: null`
- [x] 3.7 Test: subagent nesting — spawn_agent call + 3 child tool_calls → spawn_agent entry has `children.length === 3`, top-level has only the spawn_agent entry
- [x] 3.8 Test: unparseable tool_call content — entry with `result: null`, no crash
- [x] 3.9 Run `bun test src/mainview/utils/pairToolMessages.test.ts` — all tests pass

## 4. Update `TaskDetailDrawer.vue`

- [x] 4.1 Replace the inline `pairToolMessages` + `ToolEntry` with the import from `../utils/pairToolMessages`
- [x] 4.2 In `displayItems` computed: after building `ToolEntry[]` from a tool-message run, filter out entries with `children` where `parent_tool_call_id` is set at the top level (nesting is already handled inside `pairToolMessages`)
- [x] 4.3 No other changes needed in `displayItems` — the loop already handles the tool-message boundary correctly once pairing is fixed

## 5. Update `ToolCallGroup.vue`

- [x] 5.1 Import `ToolEntry` from the new utility path
- [x] 5.2 Update `statusIcon` computed: when `entry.result` is null, check `Date.now() - new Date(entry.call.createdAt).getTime() > 30_000`; if stale return `"pi-question-circle"` with grey style; otherwise return `"pi-spin pi-spinner"`
- [x] 5.3 Add a `children` body section in the template: when `entry.children.length > 0` and `open`, render a nested list of `ToolCallGroup` components for each child entry inside the expanded body — this creates the Cursor/Copilot-style subagent collapsible
- [x] 5.4 Style the nested children with a left-border indent to visually convey hierarchy

## 6. Regression and Smoke Tests

- [x] 6.1 Run `bun test src/bun/test --timeout 20000` — existing backend tests pass
- [x] 6.2 Manually verify in the running app (bun run dev:test): open a task that used batched tools and confirm all tool calls show correct results
- [x] 6.3 Manually verify: an edit_file call on the Copilot path shows a file diff accordion
- [x] 6.4 Manually verify: a spawn_agent call shows nested child tools inside its expanded body
