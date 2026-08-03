import type { TaskRow } from "../../db/row-types";
import type { Db } from "../../db/db.ts";
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
 * @param db - Db port instance
 * @param conversationId - The conversation ID to seed
 * @param boardId - The board ID to get workspace context from
 */
export async function seedConversationModel(
  db: Db,
  conversationId: number,
  boardId: number,
  wsRepo: IWorkspaceRepository,
): Promise<void> {
  const workspaceKey = await wsRepo.getBoardWorkspaceKey(boardId);
  const config = getWorkspaceConfig(workspaceKey);

  const modelToSet = config.defaultModel ?? null;

  if (modelToSet) {
    const current = await db.get<{ model: string | null }>(
      "SELECT model FROM conversations WHERE id = $1",
      [conversationId],
    );

    if (!current?.model) {
      await db.exec("UPDATE conversations SET model = $1 WHERE id = $2", [
        modelToSet,
        conversationId,
      ]);
    }
  }
}

