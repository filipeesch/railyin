import { describe, it, expect } from "vitest";
import { resolveTaskModel } from "../engine/execution/model-resolver.ts";
import type { EngineConfig } from "../config/index.ts";

const copilotEngine = (model: string | undefined): EngineConfig =>
  ({ type: "copilot", model } as EngineConfig);

// R-1: all three sources set — column wins
describe("resolveTaskModel", () => {
  it("returns columnModel when all sources are set", () => {
    expect(resolveTaskModel("col-model", "task-model", copilotEngine("engine-model"))).toBe("col-model");
  });

  // R-2: column absent, task set — task wins
  it("returns taskModel when columnModel is absent", () => {
    expect(resolveTaskModel(null, "task-model", copilotEngine("engine-model"))).toBe("task-model");
  });

  // R-3: column and task absent, engine set — engine wins
  it("returns engine.model when columnModel and taskModel are absent", () => {
    expect(resolveTaskModel(null, null, copilotEngine("engine-model"))).toBe("engine-model");
  });

  // R-4: all absent — empty string
  it("returns empty string when all sources are absent", () => {
    expect(resolveTaskModel(null, null, copilotEngine(undefined))).toBe("");
  });

  // R-5: empty string treated as not-set for columnModel
  it("skips empty string columnModel and falls through to taskModel", () => {
    expect(resolveTaskModel("", "task-model", copilotEngine("engine-model"))).toBe("task-model");
  });

  // R-6: empty string treated as not-set for taskModel
  it("skips empty string taskModel and falls through to engine.model", () => {
    expect(resolveTaskModel(null, "", copilotEngine("engine-model"))).toBe("engine-model");
  });

  // R-7: engine type without model field — no crash
  it("handles engine config without model field gracefully", () => {
    const engineWithoutModel = { type: "copilot" } as EngineConfig;
    expect(resolveTaskModel(null, "task-model", engineWithoutModel)).toBe("task-model");
  });
});
