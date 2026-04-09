/**
 * Task 3.3: Non-common tool definitions and executeTool() for the native engine.
 *
 * Owns: all file/shell/search/web/spawn-agent tool definitions (TOOL_DEFINITIONS),
 * tool groups (TOOL_GROUPS), helper functions (resolveToolsForColumn,
 * getToolDescriptionBlock, executeTool, extractCommandBinaries, myersDiff, etc.).
 *
 * Common task-management tools (tasks_read + tasks_write groups) live in
 * engine/common-tools.ts so they can be shared with the Copilot engine.
 *
 * Implementation currently lives in workflow/tools.ts pending the full code
 * migration pass (Task 8.2). These re-exports establish the canonical import
 * path so callers can already reference engine/native/tools.ts.
 */

export {
  // Types
  type WriteResult,
  type ShellApprovalDecision,
  type TaskToolCallbacks,
  type ToolContext,
  // Tool definitions & groups
  TOOL_DEFINITIONS,
  TOOL_GROUPS,
  getToolDescriptionBlock,
  resolveToolsForColumn,
  // Execution
  executeTool,
  extractCommandBinaries,
  // Diff utility (used by code-review path)
  myersDiff,
} from "../../workflow/tools.ts";
