import type { Attachment } from "@shared/rpc-types";

export interface QueuedMessage {
  id: string;
  /** Raw CM6 document text (chip tokens preserved). Shown in badge chips. */
  text: string;
  /** Slash-prompt resolved content, captured at queue time. Sent to AI. */
  engineText: string;
  attachments: Attachment[];
  addedAt: number;
}

export interface QueueState {
  items: QueuedMessage[];
  /** ID of the item currently loaded into the editor for editing. */
  editingId: string | null;
}

export function emptyQueueState(): QueueState {
  return { items: [], editingId: null };
}
