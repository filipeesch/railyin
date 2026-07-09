import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, setupTestConfig } from "./helpers.ts";
import { applyModelParamsPolicy } from "../conversation/model-params-policy.ts";
import type { EngineModelInfo } from "../engine/types.ts";

let db: Database;
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

beforeEach(() => {
  db = initDb();
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

function createConversation(initialModelParams: string | null): number {
  db.run(
    "INSERT INTO conversations (task_id, model, model_params) VALUES (NULL, NULL, ?)",
    [initialModelParams],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

function getModelParams(conversationId: number): string | null {
  return db
    .query<{ model_params: string | null }, [number]>(
      "SELECT model_params FROM conversations WHERE id = ?",
    )
    .get(conversationId)?.model_params ?? null;
}

describe("model-params model switch policy", () => {
  it("keeps compatible value on model switch", () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "medium" }]);
    const conversationId = createConversation(initialParams);
    applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithEffort });
    const result = getModelParams(conversationId);
    expect(JSON.parse(result!)).toEqual([{ id: "reasoningEffort", value: "medium" }]);
  });

  it("clears incompatible value when target model has no support", () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "high" }]);
    const conversationId = createConversation(initialParams);
    applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithoutEffort });
    expect(getModelParams(conversationId)).toBeNull();
  });

  it("persists default when no explicit override exists", () => {
    const conversationId = createConversation(null);
    applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithEffort });
    const result = getModelParams(conversationId);
    expect(JSON.parse(result!)).toEqual([{ id: "reasoningEffort", value: "medium" }]);
  });

  it("clears all params when switching to model with no settings", () => {
    const initialParams = JSON.stringify([{ id: "reasoningEffort", value: "high" }]);
    const conversationId = createConversation(initialParams);
    applyModelParamsPolicy(db, { conversationId, engineModel: engineModelWithoutEffort });
    expect(getModelParams(conversationId)).toBeNull();
  });
});
