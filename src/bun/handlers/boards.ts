import type { Database } from "bun:sqlite";
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

export function boardHandlers(db: Database) {
  return {
    "boards.list": async (): Promise<Array<Board & { template: WorkflowTemplate }>> => {
      // Use extracted function to get board IDs, then query with task counts
      const boardRows = listBoardsByWorkspace(db);
      if (boardRows.length === 0) return [];

      // Build parameterized query with individual placeholders for each board ID
      const boardIds: number[] = boardRows.map((b) => b.id);
      const placeholders = boardIds.map(() => "?").join(", ");
      const rows = (db
        .prepare(`SELECT b.*, COUNT(t.id) as task_count FROM boards b LEFT JOIN tasks t ON t.board_id = b.id WHERE b.id IN (${placeholders}) GROUP BY b.id ORDER BY b.created_at ASC`)
        .all(boardIds as any) as unknown) as Array<BoardRow & { task_count: number }>;

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

      const result = db.run(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES (?, ?, ?, ?)",
        [params.workspaceKey, params.name.trim(), templateId, JSON.stringify(params.projectKeys ?? [])],
      );

      const row = db
        .query<BoardRow, [number]>("SELECT * FROM boards WHERE id = ?")
        .get(result.lastInsertRowid as number)!;

      return mapBoard(row);
    },

    "boards.update": async (params: { id: number; name?: string; workflowTemplateId?: string; projectKeys?: string[] }): Promise<Board> => {
      const existingRow = db.query<BoardRow, [number]>("SELECT * FROM boards WHERE id = ?").get(params.id);
      if (!existingRow) throw new Error(`Board ${params.id} not found`);

      if (params.workflowTemplateId !== undefined) {
        const workspaceConfig = getWorkspaceConfig(existingRow.workspace_key);
        const valid = workspaceConfig.workflows.some((w) => w.id === params.workflowTemplateId);
        if (!valid) throw new Error(`Workflow template "${params.workflowTemplateId}" not found`);
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      if (params.name !== undefined) { updates.push("name = ?"); values.push(params.name.trim()); }
      if (params.workflowTemplateId !== undefined) { updates.push("workflow_template_id = ?"); values.push(params.workflowTemplateId); }
      if (params.projectKeys !== undefined) { updates.push("project_keys = ?"); values.push(JSON.stringify(params.projectKeys)); }

      if (updates.length === 0) {
        return mapBoard(existingRow, 0);
      }

      values.push(params.id);
      db.run(`UPDATE boards SET ${updates.join(", ")} WHERE id = ?`, values as import("bun:sqlite").SQLQueryBindings[]);

      const updatedRow = db.query<BoardRow, [number]>("SELECT * FROM boards WHERE id = ?").get(params.id)!;
      return mapBoard(updatedRow, 0);
    },

    "boards.delete": async (params: { id: number }): Promise<Record<string, never>> => {
      const taskCount = db
        .query<{ count: number }, [number]>("SELECT COUNT(*) as count FROM tasks WHERE board_id = ?")
        .get(params.id);
      if (taskCount && taskCount.count > 0) {
        throw new Error(`Cannot delete board: it has ${taskCount.count} task(s). Delete all tasks first.`);
      }
      db.run("DELETE FROM boards WHERE id = ?", [params.id]);
      return {};
    },
  };
}
