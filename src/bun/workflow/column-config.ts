import type { LoadedConfig, WorkflowTemplateConfig } from "../config/index.ts";
import { getDb } from "../db/index.ts";

export function getColumnConfig(config: LoadedConfig, boardId: number, columnId: string) {
  const db = getDb();
  const board = db
    .query<{ workflow_template_id: string }, [number]>(
      "SELECT workflow_template_id FROM boards WHERE id = ?",
    )
    .get(boardId);
  const templateId = board?.workflow_template_id ?? "delivery";
  const template = config.workflows.find((w) => w.id === templateId);
  return template?.columns.find((c) => c.id === columnId) ?? null;
}

export function getWorkflowTemplate(
  config: LoadedConfig,
  boardId: number,
): WorkflowTemplateConfig | null {
  const db = getDb();
  const board = db
    .query<{ workflow_template_id: string }, [number]>(
      "SELECT workflow_template_id FROM boards WHERE id = ?",
    )
    .get(boardId);
  const templateId = board?.workflow_template_id ?? "delivery";
  return config.workflows.find((w) => w.id === templateId) ?? null;
}

export function buildSystemInstructions(
  config: LoadedConfig,
  boardId: number,
  columnId: string,
): string | undefined {
  const template = getWorkflowTemplate(config, boardId);
  const column = template?.columns.find((c) => c.id === columnId);
  const parts = [template?.workflow_instructions, column?.stage_instructions].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
