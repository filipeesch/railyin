/**
 * Task 3.2: Agentic loop for the native engine.
 *
 * Owns: runExecution() (the main AI streaming loop), runSubExecution() (in-memory
 * child agent for spawn_agent), and the public entry-point functions that wrap
 * them: handleTransition(), handleHumanTurn(), handleRetry(), handleCodeReview().
 *
 * Additionally owns: cancelExecution(), getApprovedCommands(),
 * appendApprovedCommands(), resolveShellApproval().
 *
 * The loop will eventually yield EngineEvent via AsyncIterable (per the task spec)
 * so NativeEngine.execute() can consume it directly instead of using the async
 * channel bridge. That refactor is deferred to Task 8.1 when the full code
 * migration from workflow/engine.ts occurs.
 *
 * Implementation currently lives in workflow/engine.ts pending the full code
 * migration pass (Task 8.1). These re-exports establish the canonical import
 * path so callers can already reference engine/native/loop.ts.
 */

export type {
  OnToken,
  OnError,
  OnTaskUpdated,
  OnNewMessage,
} from "../../workflow/engine.ts";

export {
  // Cancellation / approval
  cancelExecution,
  getApprovedCommands,
  appendApprovedCommands,
  resolveShellApproval,
  // Public entry points (wrap runExecution internally)
  handleTransition,
  handleHumanTurn,
  handleRetry,
  handleCodeReview,
} from "../../workflow/engine.ts";
