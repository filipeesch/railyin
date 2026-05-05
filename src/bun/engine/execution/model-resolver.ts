import type { TaskRow } from "../../db/row-types";
import type { Database } from "bun:sqlite";
import type { IWorkspaceRepository } from "../../db/workspace-repository";
import { getWorkspaceConfig } from "../../workspace-context";

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
 * Uses the first allowed engine's configured model (multi-engine aware).
 * 
 * @param db - Database instance
 * @param conversationId - The conversation ID to seed
 * @param boardId - The board ID to get workspace context from
 */
export function seedConversationModel(
  db: Database,
  conversationId: number,
  boardId: number,
  wsRepo: IWorkspaceRepository,
): void {
  const workspaceKey = wsRepo.getBoardWorkspaceKey(boardId);
  const config = getWorkspaceConfig(workspaceKey);
  
  // Use workspace-level default, then fall back to the first engine's configured model
  const workspaceDefaultModel = config.workspace.default_model ?? null;
  const firstEngineModel = config.engines[0]?.config.model ?? null;
  
  const modelToSet = workspaceDefaultModel ?? firstEngineModel ?? null;
  
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

