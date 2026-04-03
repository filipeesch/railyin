import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { Board, WorkflowTemplate } from "../../shared/rpc-types.ts";
import type { BoardRow } from "../db/row-types.ts";
import { mapBoard } from "../db/mappers.ts";

function templateToWorkflowTemplate(t: ReturnType<typeof getConfig>["workflows"][0]): WorkflowTemplate {
  return {
    id: t.id,
    name: t.name,
    columns: t.columns.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      onEnterPrompt: c.on_enter_prompt,
      stageInstructions: c.stage_instructions,
      model: c.model,
    })),
  };
}

export function boardHandlers() {
  return {
    "boards.list": async (): Promise<Array<Board & { template: WorkflowTemplate }>> => {
      const db = getDb();
      const config = getConfig();
      const rows = db
        .query<BoardRow, []>("SELECT * FROM boards ORDER BY created_at ASC")
        .all();

      return rows.map((row) => {
        const board = mapBoard(row);
        const rawTemplate = config.workflows.find((w) => w.id === row.workflow_template_id)
          ?? config.workflows[0]!;
        return { ...board, template: templateToWorkflowTemplate(rawTemplate) };
      });
    },

    "boards.create": async (params: {
      name: string;
      projectIds: number[];
      workflowTemplateId: string;
    }): Promise<Board> => {
      const db = getDb();
      const config = getConfig();

      // Validate that the workflow template exists; fall back to first available
      const template = config.workflows.find((w) => w.id === params.workflowTemplateId);
      const templateId = template?.id ?? config.workflows[0]?.id ?? "delivery";

      const result = db.run(
        "INSERT INTO boards (workspace_id, name, workflow_template_id, project_ids) VALUES (1, ?, ?, ?)",
        [params.name.trim(), templateId, JSON.stringify(params.projectIds ?? [])],
      );

      const row = db
        .query<BoardRow, [number]>("SELECT * FROM boards WHERE id = ?")
        .get(result.lastInsertRowid as number)!;

      return mapBoard(row);
    },
  };
}
