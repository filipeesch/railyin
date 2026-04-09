/**
 * Task 3.5: Compaction utilities for the native engine.
 *
 * Owns: micro-compact constants, compactMessages(), extractSummaryBlock(),
 * compactConversation().
 *
 * Implementation currently lives in workflow/engine.ts pending the full code
 * migration pass (Task 8.1). These re-exports establish the canonical import
 * path so callers can already reference engine/native/compaction.ts.
 */

export {
  MICRO_COMPACT_TURN_WINDOW,
  MICRO_COMPACT_SENTINEL,
  MICRO_COMPACT_CLEARABLE_TOOLS,
  compactMessages,
  extractSummaryBlock,
  compactConversation,
} from "../../workflow/engine.ts";
