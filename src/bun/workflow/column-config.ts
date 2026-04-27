import type { LoadedConfig } from "../config/index.ts";
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
