/**
 * stream-tree.ts — Pure function to build a hierarchical block tree from
 * a flat sequence of persisted stream events.
 *
 * The tree is the source of truth for the chat timeline renderer.
 * Each root-level block is a direct child of the conversation; nested blocks
 * (e.g., reasoning inside a tool call, child tool calls) hang off their
 * parent's `children[]` array.
 *
 * Placement rules:
 *  - `parentBlockId` null                      → push to `roots`
 *  - `parentBlockId` set AND parent found       → push to `parent.children`
 *  - `parentBlockId` set AND parent NOT found   → orphan-promote to `roots`
 *
 * Merge rule:
 *  - When the same `blockId` appears again (tool_result after tool_call),
 *    update the existing block in-place rather than adding a new node.
 *
 * Skipped events:
 *  - `blockId === ""`            (pre-batcher ephemeral chunks)
 *  - type `"done"`               (terminal signal, not a content node)
 *  - type `"status_chunk"`       (ephemeral, IPC-only)
 *  - type `"text_chunk"`         (ephemeral, IPC-only)
 *  - type `"reasoning_chunk"`    (ephemeral, IPC-only)
 */

export interface TreeBlock {
  blockId: string;
  /** First event type seen for this blockId (e.g., "tool_call" even after tool_result arrives). */
  type: string;
  /** Accumulated / latest content for this block. */
  content: string;
  metadata: string | null;
  parentBlockId: string | null;
  /** Ordered list of child blockIds (in arrival order). */
  children: string[];
}

export interface StreamTree {
  /** Root-level blockIds in arrival order. */
  roots: string[];
  /** Map of blockId → TreeBlock for the full tree. */
  blocks: Map<string, TreeBlock>;
}

interface StreamEventLike {
  blockId: string;
  type: string;
  content: string;
  metadata: string | null;
  parentBlockId: string | null;
}

const SKIP_TYPES = new Set(["done", "status_chunk", "text_chunk", "reasoning_chunk"]);

export function buildStreamTree(events: StreamEventLike[]): StreamTree {
  const roots: string[] = [];
  const blocks = new Map<string, TreeBlock>();

  for (const event of events) {
    if (!event.blockId || SKIP_TYPES.has(event.type)) continue;

    const existing = blocks.get(event.blockId);
    if (existing) {
      // Merge: tool_result updates the same blockId as its tool_call.
      // Preserve the original type; update content and metadata.
      existing.content = event.content;
      if (event.metadata !== null) existing.metadata = event.metadata;
      continue;
    }

    const block: TreeBlock = {
      blockId: event.blockId,
      type: event.type,
      content: event.content,
      metadata: event.metadata,
      parentBlockId: event.parentBlockId,
      children: [],
    };
    blocks.set(event.blockId, block);

    if (event.parentBlockId) {
      const parent = blocks.get(event.parentBlockId);
      if (parent) {
        parent.children.push(event.blockId);
      } else {
        // Orphan-promote: parent not yet seen — treat as root
        roots.push(event.blockId);
      }
    } else {
      roots.push(event.blockId);
    }
  }

  return { roots, blocks };
}
