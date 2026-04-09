/**
 * Task 3.4: Message assembly and context estimation for the native engine.
 *
 * Owns: appendMessage(), assembleMessages() (internal), estimateContextUsage(),
 * estimateContextWarning(), resolveModelContextWindow().
 *
 * Implementation currently lives in workflow/engine.ts pending the full code
 * migration pass (Task 8.1). These re-exports establish the canonical import
 * path so callers can already reference engine/native/context.ts.
 */

export {
  appendMessage,
  estimateContextUsage,
  estimateContextWarning,
  resolveModelContextWindow,
} from "../../workflow/engine.ts";

// assembleMessages is intentionally not exported here — it is private to the
// agentic loop and only called from loop.ts.
