import { getDb } from "../db/index.ts";
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
    })),
  };
}

export function boardHandlers() {
  return {
    "boards.list": async (): Promise<Array<Board & { template: WorkflowTemplate }>> => {
      const db = getDb();
      const rows = db
        .query<BoardRow, []>("SELECT * FROM boards ORDER BY created_at ASC")
        .all();

      return rows.map((row) => {
        const board = mapBoard(row);
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
      const db = getDb();
      const config = getWorkspaceConfig(params.workspaceKey);

      // Validate that the workflow template exists; fall back to first available
      const template = config.workflows.find((w) => w.id === params.workflowTemplateId);
      const templateId = template?.id ?? config.workflows[0]?.id ?? "delivery";

      const result = db.run(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES (?, ?, ?, ?)",
        [params.workspaceKey, params.name.trim(), templateId, JSON.stringify(params.projectKeys ?? [])],
      );

      const row = db
        .query<BoardRow, [number]>("SELECT * FROM boards WHERE id = ?")
        .get(result.lastInsertRowid as number)!;

      return mapBoard(row);
    },
  };
}
