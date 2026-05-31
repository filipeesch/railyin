## Why

Conversation history fails to render for chat sessions and tasks whose loaded page contains subagent tool calls whose parent `delegate`/`spawn_agent` call sits in an **older, not-yet-loaded** page. The frontend filter at `ConversationBody.vue:158` unconditionally drops every top-level `tool_call` whose `metadata.parent_tool_call_id` is set — on the assumption the parent is on the same page and will host it. With cursor-based pagination this assumption breaks: orphaned subagent children disappear from the UI even though `pairToolMessages` returned them at the top level, leaving pages of 50 messages that render only 1–2 visible items. The bug surfaced after `14a5399` wired `boardTools` (delegate) into chat sessions, multiplied by the merge from main that landed Pi `delegate` in `ef59afe`.

## What Changes

- Move subagent-child filtering out of `ConversationBody.vue` and into `pairToolMessages`, which already owns parent/child nesting and has the context to distinguish "nested-under-loaded-parent" from "orphaned-from-older-page".
- Treat subagent children whose parent is **not present in the loaded message slice** as first-class top-level entries so they render standalone (with a visual hint that they belong to a subagent run on an older page).
- Remove the now-redundant `if (typeof meta?.parent_tool_call_id === "string") continue;` guard from `ConversationBody.vue`.
- Extract the `displayItems` computed from `ConversationBody.vue` into a pure `buildDisplayItems(messages, hasStreamTail)` utility (see `subagent-pagination-test-suite` change for test coverage). This extraction is part of this change — it makes the display logic testable and follows the `pairToolMessages.ts` pattern.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chat-tool-call-rendering`: subagent children must remain visible when their spawning parent is not in the loaded page slice (pagination-safe nesting).

## Impact

- **Code**: `src/mainview/utils/pairToolMessages.ts` (nesting logic owns the filter), `src/mainview/components/ConversationBody.vue` (drop the orphan filter at line 158; delegate `displayItems` computed to `buildDisplayItems`), `src/mainview/utils/buildDisplayItems.ts` (new pure utility extracted from component).
- **No backend changes**: backend already returns the subagent children correctly; this is a pure frontend rendering correctness fix.
- **No data migration**: existing conversations with subagent children become visible immediately on reload.
- **Tests**: covered by `subagent-pagination-test-suite` change (unit tests for `buildDisplayItems` + `pairToolMessages`, Playwright specs PAG-11, PAG-12, S-D5, CD-J).
