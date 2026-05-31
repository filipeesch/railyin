import { pairToolMessages, type ToolEntry } from "./pairToolMessages";
import type { ConversationMessage } from "@shared/rpc-types";

const TOOL_MSG_TYPES = new Set(["tool_call", "tool_result", "file_diff"]);

export type DisplayItem =
  | { kind: "tool_entry"; entry: ToolEntry; key: string }
  | { kind: "code_review"; message: ConversationMessage; key: string }
  | { kind: "single"; message: ConversationMessage; msgIndex: number; key: string }
  | { kind: "stream_tail"; key: string };

/**
 * Build the flat list of display items from a loaded message slice.
 *
 * Rules:
 *   - Adjacent tool-type messages (tool_call / tool_result / file_diff) are
 *     batched and paired into ToolEntry trees via pairToolMessages.
 *   - code_review messages consume the immediately following user "=== Code Review ===" message.
 *   - All other messages map to a single "single" item.
 *   - When hasStreamTail is true, a trailing "stream_tail" sentinel is appended.
 *
 * Subagent nesting is delegated entirely to pairToolMessages, which returns
 * orphaned children (parent not present in this slice) as top-level entries.
 * buildDisplayItems trusts that result and does NOT apply additional filtering.
 */
export function buildDisplayItems(
  messages: ConversationMessage[],
  hasStreamTail: boolean,
): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i].type === "code_review") {
      items.push({ kind: "code_review", message: messages[i], key: `cr-${messages[i].id}` });
      i++;
      if (i < messages.length && messages[i].type === "user" && messages[i].content.startsWith("=== Code Review ===")) {
        i++;
      }
    } else if (TOOL_MSG_TYPES.has(messages[i].type)) {
      const toolMsgs: ConversationMessage[] = [];
      while (i < messages.length && TOOL_MSG_TYPES.has(messages[i].type)) {
        toolMsgs.push(messages[i]);
        i++;
      }
      const entries = pairToolMessages(toolMsgs);
      for (const entry of entries) {
        items.push({ kind: "tool_entry", entry, key: `e-${entry.call.id}` });
      }
    } else {
      items.push({ kind: "single", message: messages[i], msgIndex: i, key: `s-${messages[i].id}` });
      i++;
    }
  }
  if (hasStreamTail) {
    items.push({ kind: "stream_tail", key: "stream-tail" });
  }
  return items;
}
