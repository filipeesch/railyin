import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, setupTestConfig } from "./helpers.ts";
import { applyModelParamsPolicy } from "../conversation/model-params-policy.ts";
import type { EngineModelInfo } from "../engine/types.ts";

let db: Db;
let cleanupConfig: () => void;

const engineModelWithEffort: EngineModelInfo = {
  qualifiedId: "copilot/alpha",
  displayName: "Alpha",
  settings: [
    {
      id: "reasoningEffort",
      label: "Reasoning Effort",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
      defaultValue: "medium",
      visible: true,
      axisType: "select",
    },
  ],
};

const engineModelWithoutEffort: EngineModelInfo = {
  qualifiedId: "copilot/basic",
  displayName: "Basic",
  settings: [],
};

beforeEach(async () => {
  db = await initDb();
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

async function createConversation(initialModelParams: string | null): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO conversations (task_id, model, model_params) VALUES (NULL, NULL, $1) RETURNING id",
    [initialModelParams],
  );
  return row!.id;
}

async function getModelParams(conversationId: number): Promise<string | null> {
  return (
    await db.get<{ model_params: string | null }>(
      "SELECT model_params FROM conversations WHERE id = $1",
      [conversationId],
    )
  )?.model_params ?? null;
}

describe("model-params model switch policy", () => {
  it("keeps compatible value on model switch", async () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "medium" }]);
    const conversationId = await createConversation(initialParams);
    await applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithEffort });
    const result = await getModelParams(conversationId);
    expect(JSON.parse(result!)).toEqual([{ id: "reasoningEffort", value: "medium" }]);
  });

  it("clears incompatible value when target model has no support", async () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "high" }]);
    const conversationId = await createConversation(initialParams);
    await applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithoutEffort });
    expect(await getModelParams(conversationId)).toBeNull();
  });

  it("persists default when no explicit override exists", async () => {
    const conversationId = await createConversation(null);
    await applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithEffort });
    const result = await getModelParams(conversationId);
    expect(JSON.parse(result!)).toEqual([{ id: "reasoningEffort", value: "medium" }]);
  });

  it("clears all params when switching to model with no settings", async () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "high" }]);
    const conversationId = await createConversation(initialParams);
    await applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithoutEffort });
    expect(await getModelParams(conversationId)).toBeNull();
  });
});
