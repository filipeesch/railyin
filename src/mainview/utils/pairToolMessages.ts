import type { ConversationMessage } from "@shared/rpc-types";

export type ToolEntry = {
  call:     ConversationMessage;
  result:   ConversationMessage | null;
  diff:     ConversationMessage | null;
  children: ToolEntry[];
};

function parseCallId(msg: ConversationMessage): string | null {
  try {
    const p = JSON.parse(msg.content) as { id?: string };
    return typeof p.id === "string" ? p.id : null;
  } catch {
    return null;
  }
}

function parseResultCallId(msg: ConversationMessage): string | null {
  try {
    const p = JSON.parse(msg.content) as { tool_use_id?: string };
    return typeof p.tool_use_id === "string" ? p.tool_use_id : null;
  } catch {
    return null;
  }
}

function getDiffCallId(msg: ConversationMessage): string | null {
  const meta = msg.metadata as Record<string, unknown> | null;
  return typeof meta?.tool_call_id === "string" ? meta.tool_call_id : null;
}

function getParentCallId(msg: ConversationMessage): string | null {
  const meta = msg.metadata as Record<string, unknown> | null;
  return typeof meta?.parent_tool_call_id === "string" ? meta.parent_tool_call_id : null;
}

/**
 * Pair a flat list of tool-type messages into ToolEntry trees.
 *
 * Pairing is ID-based (not positional):
 *   - tool_call   carries `id` in its content JSON
 *   - tool_result carries `tool_use_id` in its content JSON
 *   - file_diff   carries `tool_call_id` in its metadata
 *
 * Subagent nesting:
 *   tool_call rows with `metadata.parent_tool_call_id` set are nested as
 *   children of the spawn_agent entry that owns them, and removed from the
 *   top-level result list.
 *
 * Edge cases:
 *   - Orphaned results / diffs (no matching call) are silently dropped.
 *   - Unparseable tool_call content yields { result: null, diff: null }.
 *   - tool_calls with no result older than 30s are rendered with a timeout
 *     state in ToolCallGroup.vue — this function does not filter them out.
 */
export function pairToolMessages(msgs: ConversationMessage[]): ToolEntry[] {
  // Index results and diffs by their call ID
  const resultByCallId = new Map<string, ConversationMessage>();
  const diffByCallId   = new Map<string, ConversationMessage>();

  for (const msg of msgs) {
    if (msg.type === "tool_result") {
      const id = parseResultCallId(msg);
      if (id) resultByCallId.set(id, msg);
    } else if (msg.type === "file_diff") {
      const id = getDiffCallId(msg);
      if (id) diffByCallId.set(id, msg);
    }
  }

  // Build flat list of entries for each tool_call
  const allEntries: ToolEntry[] = [];
  const entryByCallId = new Map<string, ToolEntry>();

  for (const msg of msgs) {
    if (msg.type !== "tool_call") continue;
    const callId = parseCallId(msg);
    const result = callId ? (resultByCallId.get(callId) ?? null) : null;
    const diff   = callId ? (diffByCallId.get(callId) ?? null)   : null;
    const entry: ToolEntry = { call: msg, result, diff, children: [] };
    allEntries.push(entry);
    if (callId) entryByCallId.set(callId, entry);
  }

  // Nest subagent children under their spawn_agent parent
  const topLevel: ToolEntry[] = [];
  for (const entry of allEntries) {
    const parentId = getParentCallId(entry.call);
    if (parentId) {
      const parent = entryByCallId.get(parentId);
      if (parent) {
        parent.children.push(entry);
        continue;
      }
    }
    topLevel.push(entry);
  }

  return topLevel;
}
