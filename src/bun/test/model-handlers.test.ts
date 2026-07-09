import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, setupTestConfig } from "./helpers.ts";
import { modelHandlers } from "../handlers/models.ts";
import { SqliteModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { Database } from "bun:sqlite";

const mockOrchestrator = {
  listModels: async (_workspaceKey: string) => [
    {
      qualifiedId: "copilot/gpt-4o",
      displayName: "GPT-4o",
      description: "desc",
      contextWindow: 128000,
      supportsThinking: false,
      supportsManualCompact: false,
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
        },
      ],
    },
    { qualifiedId: "copilot/gpt-4", displayName: "GPT-4", description: "desc2", contextWindow: 8192, supportsThinking: false, supportsManualCompact: false, settings: [] },
  ],
} as unknown as ExecutionCoordinator;

/** Orchestrator that exposes a Pi model with contextWindowEditable: true. */
const mockOrchestratorWithPi = {
  listModels: async (_workspaceKey: string) => [
    { qualifiedId: "pi/llama-3.3-70b", displayName: "Llama 3.3 70B", description: "Pi model", contextWindow: 128_000, contextWindowEditable: true, supportsThinking: false, supportsManualCompact: false },
    { qualifiedId: "copilot/gpt-4o", displayName: "GPT-4o", description: "desc", contextWindow: 128_000, contextWindowEditable: false, supportsThinking: false, supportsManualCompact: false },
  ],
} as unknown as ExecutionCoordinator;

let db: Database;
let cleanupConfig: () => void;

beforeEach(() => {
  db = initDb();
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

describe("modelHandlers — MH-1: models.setEnabled writes to enabled_models and models.listEnabled reflects it", () => {
  it("listEnabled returns only the enabled model after setEnabled", async () => {
    const handlers = modelHandlers(db, mockOrchestrator);

    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4o", enabled: true });

    const enabled = await handlers["models.listEnabled"]();
    const ids = enabled.map((m) => m.id);

    expect(ids).toContain("copilot/gpt-4o");
    expect(ids).not.toContain("copilot/gpt-4");
  });
});

describe("modelHandlers — MH-2: models.setEnabled with enabled:false removes entry", () => {
  it("listEnabled returns all engine models when no DB entries remain (default-all-enabled)", async () => {
    const handlers = modelHandlers(db, mockOrchestrator);

    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4o", enabled: true });
    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4o", enabled: false });

    const enabled = await handlers["models.listEnabled"]();
    const ids = enabled.map((m) => m.id);

    // No entries in DB → default-all-enabled: both engine models should be returned
    expect(ids).toContain("copilot/gpt-4o");
    expect(ids).toContain("copilot/gpt-4");
  });
});

describe("modelHandlers — MH-3: models.list returns providers with enabled field", () => {
  it("gpt-4o is enabled:true and gpt-4 is enabled:false after enabling only gpt-4o", async () => {
    const handlers = modelHandlers(db, mockOrchestrator);

    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4o", enabled: true });

    const list = await handlers["models.list"]();

    const copilotProvider = list.find((p) => p.id === "copilot");
    expect(copilotProvider).toBeDefined();
    expect(copilotProvider!.models.length).toBe(2);

    const gpt4o = copilotProvider!.models.find((m) => m.id === "copilot/gpt-4o");
    const gpt4 = copilotProvider!.models.find((m) => m.id === "copilot/gpt-4");

    expect(gpt4o?.enabled).toBe(true);
    expect(gpt4?.enabled).toBe(false);
  });
});

describe("modelHandlers — model settings metadata", () => {
  it("models.listEnabled includes normalized+raw metadata for supported models", async () => {
    const handlers = modelHandlers(db, mockOrchestrator);
    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4o", enabled: true });
    const enabled = await handlers["models.listEnabled"]();
    const model = enabled.find((entry) => entry.id === "copilot/gpt-4o");
    expect(model?.modelSettings?.settings).toHaveLength(1);
    expect(model?.modelSettings?.settings[0].id).toBe("reasoningEffort");
    expect(model?.modelSettings?.settings[0].options.map(o => o.value)).toEqual(["low", "medium", "high"]);
    expect(model?.modelSettings?.settings[0].defaultValue).toBe("medium");
    expect(model?.modelSettings?.settings[0].visible).toBe(true);
  });

  it("models.listEnabled exposes hidden state for unsupported models", async () => {
    const handlers = modelHandlers(db, mockOrchestrator);
    await handlers["models.setEnabled"]({ qualifiedModelId: "copilot/gpt-4", enabled: true });
    const enabled = await handlers["models.listEnabled"]();
    const model = enabled.find((entry) => entry.id === "copilot/gpt-4");
    expect(model?.modelSettings?.settings).toEqual([]);
    expect(model?.modelSettings?.settings.length).toBe(0);
  });
});

// ─── Context window handler tests ────────────────────────────────────────────

describe("modelHandlers — MH-CTX-1: models.setContextWindow throws when no repo provided", () => {
  it("throws when modelSettingsRepo is not passed", async () => {
    const handlers = modelHandlers(db, mockOrchestratorWithPi);
    await expect(
      handlers["models.setContextWindow"]({ qualifiedModelId: "pi/llama-3.3-70b", contextWindow: 65536 }),
    ).rejects.toThrow("ModelSettingsRepository not available");
  });
});

describe("modelHandlers — MH-CTX-2: models.setContextWindow stores value and returns {}", () => {
  it("returns empty object and repo reflects stored value", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    const result = await handlers["models.setContextWindow"]({
      qualifiedModelId: "pi/llama-3.3-70b",
      contextWindow: 65536,
    });

    expect(result).toEqual({});
    expect(repo.getContextWindow("default", "pi/llama-3.3-70b")).toBe(65536);
  });
});

describe("modelHandlers — MH-CTX-3: models.setContextWindow(null) clears override", () => {
  it("storing then passing null removes the row", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    await handlers["models.setContextWindow"]({ qualifiedModelId: "pi/llama-3.3-70b", contextWindow: 65536 });
    expect(repo.getContextWindow("default", "pi/llama-3.3-70b")).toBe(65536);

    const result = await handlers["models.setContextWindow"]({
      qualifiedModelId: "pi/llama-3.3-70b",
      contextWindow: null,
    });
    expect(result).toEqual({});
    expect(repo.getContextWindow("default", "pi/llama-3.3-70b")).toBeNull();
  });
});

describe("modelHandlers — MH-CTX-4: models.list applies DB override over engine-reported value", () => {
  it("contextWindow in list response matches DB override, not engine value", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    // Engine reports 128_000; override with 200_000
    repo.setContextWindow("default", "pi/llama-3.3-70b", 200_000);

    const list = await handlers["models.list"]();
    const piProvider = list.find((p) => p.id === "pi");
    const piModel = piProvider?.models.find((m) => m.id === "pi/llama-3.3-70b");

    expect(piModel).toBeDefined();
    expect(piModel!.contextWindow).toBe(200_000);
  });
});

describe("modelHandlers — MH-CTX-5: models.list falls back to engine-reported value when no DB override", () => {
  it("contextWindow equals engine-reported value when no DB override exists", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    const list = await handlers["models.list"]();
    const piProvider = list.find((p) => p.id === "pi");
    const piModel = piProvider?.models.find((m) => m.id === "pi/llama-3.3-70b");

    expect(piModel).toBeDefined();
    expect(piModel!.contextWindow).toBe(128_000); // engine-reported
  });
});

describe("modelHandlers — MH-CTX-6: models.list passes through contextWindowEditable flag", () => {
  it("pi model has contextWindowEditable: true, copilot model does not", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    const list = await handlers["models.list"]();

    const piProvider = list.find((p) => p.id === "pi");
    const piModel = piProvider?.models.find((m) => m.id === "pi/llama-3.3-70b");
    expect(piModel?.contextWindowEditable).toBe(true);

    const copilotProvider = list.find((p) => p.id === "copilot");
    const copilotModel = copilotProvider?.models.find((m) => m.id === "copilot/gpt-4o");
    // contextWindowEditable omitted for non-editable models (undefined / falsy)
    expect(copilotModel?.contextWindowEditable).toBeFalsy();
  });
});

describe("modelHandlers — MH-CTX-7: models.setContextWindow respects explicit workspaceKey param", () => {
  it("stores and retrieves with the given workspace key, not the default", async () => {
    const repo = new SqliteModelSettingsRepository(db);
    const handlers = modelHandlers(db, mockOrchestratorWithPi, repo);

    await handlers["models.setContextWindow"]({
      workspaceKey: "my-workspace",
      qualifiedModelId: "pi/llama-3.3-70b",
      contextWindow: 32_768,
    });

    expect(repo.getContextWindow("my-workspace", "pi/llama-3.3-70b")).toBe(32_768);
    // Default workspace unaffected
    expect(repo.getContextWindow("default", "pi/llama-3.3-70b")).toBeNull();
  });
});
