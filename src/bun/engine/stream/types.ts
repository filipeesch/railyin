import type { RawModelMessage } from "../types.ts";

/** A raw provider-native model message forwarded to the WS broadcast sink.
 *  Raw messages are no longer persisted (model_raw_messages was dropped). */
export interface RawMessageItem {
  taskId: number | null;
  conversationId: number;
  executionId: number;
  raw: RawModelMessage;
}
