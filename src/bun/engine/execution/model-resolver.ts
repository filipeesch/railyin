import type { TaskRow } from "../../db/row-types";
import type { Database } from "bun:sqlite";
import { getWorkspaceConfig, getBoardWorkspaceKey } from "../../workspace-context";

/**
 * Resolves the effective model for a task based on conversation model and column configuration.
 * 
 * @param task - The task row with conversation_model joined
 * @param columnModel - Optional model defined by the workflow column
 * @param isColumnTransition - If true, column.model takes precedence and is persisted
 * @returns The resolved model string or null
 */
export function resolveModel(
  task: TaskRow & { conversation_model: string | null },
  columnModel: string | null | undefined,
  isColumnTransition: boolean = false
): string | null {
  // During column transitions, column.model takes precedence and should be persisted
  if (isColumnTransition && columnModel != null) {
    return columnModel;
  }
  
  // Otherwise, use the conversation's model
  return task.conversation_model ?? null;
}

/**
 * Seeds the conversation model with workspace default if not already set.
 * 
 * @param db - Database instance
 * @param conversationId - The conversation ID to seed
 * @param boardId - The board ID to get workspace context from
 */
export function seedConversationModel(
  db: Database,
  conversationId: number,
  boardId: number
): void {
  const workspaceKey = getBoardWorkspaceKey(boardId);
  const config = getWorkspaceConfig(workspaceKey);
  
  // Get workspace default model or engine model
  const workspaceDefaultModel = config.workspace.default_model ?? null;
  const engineModel = "model" in config.engine ? (config.engine.model ?? null) : null;
  
  // Determine which model to use
  const modelToSet = workspaceDefaultModel ?? engineModel ?? null;
  
  // Only set if we have a model and conversation doesn't already have one
  if (modelToSet) {
    const current = db.query<{ model: string | null }, [number]>(
      "SELECT model FROM conversations WHERE id = ?"
    ).get(conversationId);
    
    if (!current?.model) {
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [
        modelToSet,
        conversationId,
      ]);
    }
  }
}

