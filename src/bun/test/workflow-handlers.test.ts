import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import type { Database } from "bun:sqlite";
import { initDb, setupTestConfig } from "./helpers.ts";
import { workflowHandlers } from "../handlers/workflow.ts";
import { boardHandlers } from "../handlers/boards.ts";

const WS = "default";

let db: Database;
let cleanupConfig: (() => void) | null = null;
let notifyCount = 0;
const notify = () => { notifyCount++; };

/** Single-template workflow YAML for the `extraWorkflows` arg of setupTestConfig. */
function wf(id: string, name = id): string {
  return [
    `id: ${id}`,
    `name: ${name}`,
    "columns:",
    "  - id: backlog",
    "    label: Backlog",
    "    is_backlog: true",
    "  - id: done",
    "    label: Done",
    "",
  ].join("\n");
}

/** Configure a test workspace with `delivery` plus any extra workflow ids. */
function configure(extraIds: string[] = []): void {
  cleanupConfig = setupTestConfig("", undefined, extraIds.map((id) => wf(id))).cleanup;
}

beforeEach(() => {
  db = initDb();
  notifyCount = 0;
});

afterEach(() => {
  cleanupConfig?.();
  cleanupConfig = null;
});

describe("workflow.getYaml", () => {
  it("loads workflow YAML by matching template id even when filename differs", async () => {
    configure();
    const handlers = workflowHandlers(db, notify);
    const result = await handlers["workflow.getYaml"]({ workspaceKey: WS, templateId: "delivery" });
    expect(result.yaml).toContain("id: delivery");
  });

  it("throws for a template id with no backing file", async () => {
    configure();
    const handlers = workflowHandlers(db, notify);
    await expect(handlers["workflow.getYaml"]({ workspaceKey: WS, templateId: "ghost" })).rejects.toThrow();
  });
});

describe("workflow.list", () => {
  it("returns every workflow in the workspace", async () => {
    configure(["sprint", "review"]);
    const handlers = workflowHandlers(db, notify);
    const list = await handlers["workflow.list"]({ workspaceKey: WS });
    expect(list.map((w) => w.id).sort()).toEqual(["delivery", "review", "sprint"]);
  });

  it("marks the bundled workflow as not deletable", async () => {
    configure(["sprint"]);
    const list = await workflowHandlers(db, notify)["workflow.list"]({ workspaceKey: WS });
    const delivery = list.find((w) => w.id === "delivery")!;
    expect(delivery.deletable).toBe(false);
    expect(delivery.undeletableReason).toMatch(/bundled/i);
    // A user-created workflow with no boards is deletable.
    const sprint = list.find((w) => w.id === "sprint")!;
    expect(sprint.deletable).toBe(true);
  });

  it("reports boardCount and disables delete for a referenced workflow", async () => {
    configure(["sprint"]);
    await boardHandlers(db)["boards.create"]({
      workspaceKey: WS,
      name: "Board A",
      projectKeys: [],
      workflowTemplateId: "sprint",
    });

    const list = await workflowHandlers(db, notify)["workflow.list"]({ workspaceKey: WS });
    const sprint = list.find((w) => w.id === "sprint")!;
    expect(sprint.boardCount).toBe(1);
    expect(sprint.deletable).toBe(false);
    expect(sprint.undeletableReason).toMatch(/board/i);
  });
});

describe("workflow.create", () => {
  it("creates a workflow file, returns its id, and notifies", async () => {
    configure();
    const handlers = workflowHandlers(db, notify);
    const { id } = await handlers["workflow.create"]({ workspaceKey: WS, name: "My Flow" });

    expect(id).toBe("my-flow");
    expect(existsSync(join(process.env.RAILYN_CONFIG_DIR!, "workflows", "my-flow.yaml"))).toBe(true);
    expect(notifyCount).toBe(1);

    const list = await handlers["workflow.list"]({ workspaceKey: WS });
    expect(list.map((w) => w.id)).toContain("my-flow");
  });

  it("suffixes the id on collision", async () => {
    configure();
    const handlers = workflowHandlers(db, notify);
    const first = await handlers["workflow.create"]({ workspaceKey: WS, name: "Dup" });
    const second = await handlers["workflow.create"]({ workspaceKey: WS, name: "Dup" });
    expect(first.id).toBe("dup");
    expect(second.id).toBe("dup-2");
  });

  it("rejects an empty name", async () => {
    configure();
    const handlers = workflowHandlers(db, notify);
    await expect(handlers["workflow.create"]({ workspaceKey: WS, name: "   " })).rejects.toThrow();
  });
});

describe("workflow.saveYaml → boards.list round-trip", () => {
  it("boards.list returns updated template columns after saveYaml", async () => {
    configure();
    const wHandlers = workflowHandlers(db, notify);
    const bHandlers = boardHandlers(db);

    // Create a board referencing the delivery workflow
    const board = await bHandlers["boards.create"]({
      workspaceKey: WS,
      name: "Test Board",
      projectKeys: [],
      workflowTemplateId: "delivery",
    });

    // Verify initial state: delivery has backlog + done columns
    const before = await bHandlers["boards.list"]();
    const boardBefore = before.find((b) => b.id === board.id)!;
    expect(boardBefore.template.columns.map((c) => c.id)).not.toContain("review");

    // Edit the delivery workflow YAML to add a 'review' column
    const originalYaml = (await wHandlers["workflow.getYaml"]({ workspaceKey: WS, templateId: "delivery" })).yaml;
    const updatedYaml = originalYaml + "\n  - id: review\n    label: Review\n";

    await wHandlers["workflow.saveYaml"]({ workspaceKey: WS, templateId: "delivery", yaml: updatedYaml });

    // boards.list should now return the template with the new 'review' column
    const after = await bHandlers["boards.list"]();
    const boardAfter = after.find((b) => b.id === board.id)!;
    expect(boardAfter.template.columns.map((c) => c.id)).toContain("review");
  });

  it("saveYaml calls notifyReloaded after writing the file", async () => {
    configure();
    const wHandlers = workflowHandlers(db, notify);
    const originalYaml = (await wHandlers["workflow.getYaml"]({ workspaceKey: WS, templateId: "delivery" })).yaml;
    await wHandlers["workflow.saveYaml"]({ workspaceKey: WS, templateId: "delivery", yaml: originalYaml });
    expect(notifyCount).toBe(1);
  });
});

describe("workflow.delete", () => {
  it("deletes a free user-created workflow file and notifies", async () => {
    configure(["sprint"]);
    const handlers = workflowHandlers(db, notify);
    await handlers["workflow.delete"]({ workspaceKey: WS, templateId: "sprint" });

    expect(existsSync(join(process.env.RAILYN_CONFIG_DIR!, "workflows", "extra-0.yaml"))).toBe(false);
    expect(notifyCount).toBe(1);
    const list = await handlers["workflow.list"]({ workspaceKey: WS });
    expect(list.map((w) => w.id)).not.toContain("sprint");
  });

  it("rejects deleting a bundled workflow", async () => {
    configure(["sprint"]);
    const handlers = workflowHandlers(db, notify);
    await expect(handlers["workflow.delete"]({ workspaceKey: WS, templateId: "delivery" })).rejects.toThrow();
    expect(existsSync(join(process.env.RAILYN_CONFIG_DIR!, "workflows", "delivery.yaml"))).toBe(true);
  });

  it("rejects deleting a workflow referenced by a board", async () => {
    configure(["sprint"]);
    await boardHandlers(db)["boards.create"]({
      workspaceKey: WS,
      name: "Board A",
      projectKeys: [],
      workflowTemplateId: "sprint",
    });

    const handlers = workflowHandlers(db, notify);
    await expect(handlers["workflow.delete"]({ workspaceKey: WS, templateId: "sprint" })).rejects.toThrow();
    expect(existsSync(join(process.env.RAILYN_CONFIG_DIR!, "workflows", "extra-0.yaml"))).toBe(true);
  });
});
