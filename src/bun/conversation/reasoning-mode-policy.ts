import type { Database } from "bun:sqlite";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { normalizeModelSettings } from "../models/model-settings-normalizer.ts";

export async function applyConversationModelSwitch(
  db: Database,
  params: {
    conversationId: number;
    model: string | null;
    workspaceKey: string;
    orchestrator: ExecutionCoordinator | null;
  },
): Promise<void> {
  const current = db
    .query<{ reasoning_mode_override: string | null }, [number]>(
      "SELECT reasoning_mode_override FROM conversations WHERE id = ?",
    )
    .get(params.conversationId);
  if (!current) throw new Error(`Conversation ${params.conversationId} not found`);

  db.run("UPDATE conversations SET model = ? WHERE id = ?", [params.model, params.conversationId]);

  if (params.model == null || !params.orchestrator) {
    db.run("UPDATE conversations SET reasoning_mode_override = NULL WHERE id = ?", [params.conversationId]);
    return;
  }

  const models = await params.orchestrator.listModels(params.workspaceKey);
  const targetModel = models.find((m) => m.qualifiedId === params.model);
  const normalized = normalizeModelSettings(targetModel);
  const supported = normalized.modelSettings.reasoningMode.supportedValues;
  const currentValue = current.reasoning_mode_override;

  let nextValue: string | null = null;
  if (supported.length > 0) {
    if (currentValue != null && supported.includes(currentValue)) {
      nextValue = currentValue;
    } else if (currentValue == null && normalized.modelSettings.reasoningMode.defaultValue != null) {
      nextValue = normalized.modelSettings.reasoningMode.defaultValue;
    }
  }

  db.run("UPDATE conversations SET reasoning_mode_override = ? WHERE id = ?", [nextValue, params.conversationId]);
}
