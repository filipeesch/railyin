import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { initDb, setupTestConfig } from "./helpers.ts";
import { applyConversationModelSwitch } from "../conversation/reasoning-mode-policy.ts";

let db: Database;
let cleanupConfig: () => void;

const mockOrchestrator = {
  listModels: async () => [
    {
      qualifiedId: "copilot/alpha",
      displayName: "Alpha",
      supportedReasoningModes: ["low", "medium", "high"],
      defaultReasoningMode: "medium",
      rawReasoningModeMetadata: { source: "copilot" },
    },
    {
      qualifiedId: "copilot/basic",
      displayName: "Basic",
      supportedReasoningModes: [],
      defaultReasoningMode: null,
      rawReasoningModeMetadata: null,
    },
  ],
} as unknown as ExecutionCoordinator;

beforeEach(() => {
  db = initDb();
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

function createConversation(initialReasoningMode: string | null): number {
  db.run(
    "INSERT INTO conversations (task_id, model, reasoning_mode_override) VALUES (NULL, NULL, ?)",
    [initialReasoningMode],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

describe("reasoning-mode model switch policy", () => {
  it("keeps compatible value on model switch", async () => {
    const conversationId = createConversation("medium");
    await applyConversationModelSwitch(db, {
      conversationId,
      model: "copilot/alpha",
      workspaceKey: "default",
      orchestrator: mockOrchestrator,
    });
    const row = db
      .query<{ model: string | null; reasoning_mode_override: string | null }, [number]>(
        "SELECT model, reasoning_mode_override FROM conversations WHERE id = ?",
      )
      .get(conversationId);
    expect(row?.model).toBe("copilot/alpha");
    expect(row?.reasoning_mode_override).toBe("medium");
  });

  it("clears incompatible value when target model has no support", async () => {
    const conversationId = createConversation("high");
    await applyConversationModelSwitch(db, {
      conversationId,
      model: "copilot/basic",
      workspaceKey: "default",
      orchestrator: mockOrchestrator,
    });
    const row = db
      .query<{ reasoning_mode_override: string | null }, [number]>(
        "SELECT reasoning_mode_override FROM conversations WHERE id = ?",
      )
      .get(conversationId);
    expect(row?.reasoning_mode_override).toBeNull();
  });

  it("persists default when no explicit override exists", async () => {
    const conversationId = createConversation(null);
    await applyConversationModelSwitch(db, {
      conversationId,
      model: "copilot/alpha",
      workspaceKey: "default",
      orchestrator: mockOrchestrator,
    });
    const row = db
      .query<{ reasoning_mode_override: string | null }, [number]>(
        "SELECT reasoning_mode_override FROM conversations WHERE id = ?",
      )
      .get(conversationId);
    expect(row?.reasoning_mode_override).toBe("medium");
  });
});
