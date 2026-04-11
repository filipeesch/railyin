import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { setupTestConfig } from "./helpers.ts";
import { workspaceHandlers } from "../handlers/workspace.ts";

let cleanupConfig: () => void;

beforeEach(() => {
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

describe("workspaceHandlers", () => {
  it("returns workspace-local workflow templates in config", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const workflowsDir = join(configDir, "workflows");
    rmSync(join(configDir, "workflows.yaml"), { force: true });
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(workflowsDir, "open-spec.yaml"),
      [
        "id: openspec",
        "name: Open Spec",
        "columns:",
        "  - id: backlog",
        "    label: Backlog",
      ].join("\n"),
      "utf-8",
    );

    const handlers = workspaceHandlers();
    const result = await handlers["workspace.getConfig"]({});

    expect(result.workflows.map((workflow) => workflow.id)).toContain("openspec");
    expect(result.workflows.find((workflow) => workflow.id === "openspec")?.name).toBe("Open Spec");
  });
});
