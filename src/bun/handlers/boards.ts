import type { Db } from "../db/db.ts";
import { listBoardsByWorkspace } from "../db/board-queries.ts";

import { getConfig } from "../config/index.ts";
import type { Board, WorkflowTemplate } from "../../shared/rpc-types.ts";
import type { BoardRow } from "../db/row-types.ts";
import { mapBoard } from "../db/mappers.ts";
import { getWorkspaceConfig } from "../workspace-context.ts";

function templateToWorkflowTemplate(t: ReturnType<typeof getConfig>["workflows"][0]): WorkflowTemplate {
  return {
    id: t.id,
    name: t.name,
    columns: t.columns.map((c) => ({
      id: c.id,
      label: c.label,
      model: c.model,
      limit: c.limit,
      allowedTransitions: c.allowed_transitions,
      samplingPreset: c.sampling_preset,
    })),
    groups: t.groups,
  };
}

export function boardHandlers(db: Db) {
  return {
    "boards.list": async (): Promise<Array<Board & { template: WorkflowTemplate }>> => {
      // Use extracted function to get board IDs, then query with task counts
      const boardRows = await listBoardsByWorkspace(db);
      if (boardRows.length === 0) return [];

      // Build parameterized query with individual placeholders for each board ID
      const boardIds: number[] = boardRows.map((b) => b.id);
      const placeholders = boardIds.map((_, i) => `$${i + 1}`).join(", ");
      const rows = (await db.rows<BoardRow & { task_count: number }>(
        `SELECT b.*, COUNT(t.id) as task_count FROM boards b LEFT JOIN tasks t ON t.board_id = b.id WHERE b.id IN (${placeholders}) GROUP BY b.id ORDER BY b.created_at ASC`,
        boardIds,
      ));

      return rows.map((row) => {
        const board = mapBoard(row, row.task_count);
        const workspaceConfig = getWorkspaceConfig(row.workspace_key);
        const rawTemplate = workspaceConfig.workflows.find((w) => w.id === row.workflow_template_id)
          ?? workspaceConfig.workflows[0]!;
        return { ...board, template: templateToWorkflowTemplate(rawTemplate) };
      });
    },

    "boards.create": async (params: {
      workspaceKey: string;
      name: string;
      projectKeys: string[];
      workflowTemplateId: string;
    }): Promise<Board> => {
      const config = getWorkspaceConfig(params.workspaceKey);

      // Validate that the workflow template exists; fall back to first available
      const template = config.workflows.find((w) => w.id === params.workflowTemplateId);
      const templateId = template?.id ?? config.workflows[0]?.id;
      if (!templateId) throw new Error("No workflow templates available in this workspace");

      const result = await db.exec(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES ($1, $2, $3, $4)",
        [params.workspaceKey, params.name.trim(), templateId, JSON.stringify(params.projectKeys ?? [])],
      );

      const row = (await db
        .get<BoardRow>("SELECT * FROM boards WHERE id = $1", [result.lastInsertRowid as number]))!;

      return mapBoard(row);
    },

    "boards.update": async (params: { id: number; name?: string; workflowTemplateId?: string; projectKeys?: string[] }): Promise<Board> => {
      const existingRow = await db.get<BoardRow>("SELECT * FROM boards WHERE id = $1", [params.id]);
      if (!existingRow) throw new Error(`Board ${params.id} not found`);

      if (params.workflowTemplateId !== undefined) {
        const workspaceConfig = getWorkspaceConfig(existingRow.workspace_key);
        const valid = workspaceConfig.workflows.some((w) => w.id === params.workflowTemplateId);
        if (!valid) throw new Error(`Workflow template "${params.workflowTemplateId}" not found`);
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      if (params.name !== undefined) { values.push(params.name.trim()); updates.push(`name = $${values.length}`); }
      if (params.workflowTemplateId !== undefined) { values.push(params.workflowTemplateId); updates.push(`workflow_template_id = $${values.length}`); }
      if (params.projectKeys !== undefined) { values.push(JSON.stringify(params.projectKeys)); updates.push(`project_keys = $${values.length}`); }

      if (updates.length === 0) {
        return mapBoard(existingRow, 0);
      }

      values.push(params.id);
      await db.exec(`UPDATE boards SET ${updates.join(", ")} WHERE id = $${values.length}`, values);

      const updatedRow = (await db.get<BoardRow>("SELECT * FROM boards WHERE id = $1", [params.id]))!;
      return mapBoard(updatedRow, 0);
    },

    "boards.delete": async (params: { id: number }): Promise<Record<string, never>> => {
      const taskCount = await db
        .get<{ count: number }>("SELECT COUNT(*) as count FROM tasks WHERE board_id = $1", [params.id]);
      if (taskCount && taskCount.count > 0) {
        throw new Error(`Cannot delete board: it has ${taskCount.count} task(s). Delete all tasks first.`);
      }
      await db.exec("DELETE FROM boards WHERE id = $1", [params.id]);
      return {};
    },
  };
}
