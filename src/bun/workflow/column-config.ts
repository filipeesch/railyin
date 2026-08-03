import type { LoadedConfig, WorkflowTemplateConfig } from "../config/index.ts";
import { getDb } from "../db/index.ts";

export async function getColumnConfig(config: LoadedConfig, boardId: number, columnId: string) {
  const db = getDb();
  const board = await db.get<{ workflow_template_id: string }>(
    "SELECT workflow_template_id FROM boards WHERE id = $1",
    [boardId],
  );
  const templateId = board?.workflow_template_id ?? "delivery";
  const template = config.workflows.find((w) => w.id === templateId);
  return template?.columns.find((c) => c.id === columnId) ?? null;
}

export async function getWorkflowTemplate(
  config: LoadedConfig,
  boardId: number,
): Promise<WorkflowTemplateConfig | null> {
  const db = getDb();
  const board = await db.get<{ workflow_template_id: string }>(
    "SELECT workflow_template_id FROM boards WHERE id = $1",
    [boardId],
  );
  const templateId = board?.workflow_template_id ?? "delivery";
  return config.workflows.find((w) => w.id === templateId) ?? null;
}
