import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, setupTestConfig } from "./helpers.ts";
import { modelHandlers } from "../handlers/models.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { Database } from "bun:sqlite";

const mockOrchestrator = {
  listModels: async (_workspaceKey: string) => [
    { qualifiedId: "copilot/gpt-4o", displayName: "GPT-4o", description: "desc", contextWindow: 128000, supportsThinking: false, supportsManualCompact: false },
    { qualifiedId: "copilot/gpt-4", displayName: "GPT-4", description: "desc2", contextWindow: 8192, supportsThinking: false, supportsManualCompact: false },
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
