import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { initDb, setupTestConfig } from "./helpers.ts";
import { workflowHandlers } from "../handlers/workflow.ts";

let cleanupConfig: () => void;

beforeEach(() => {
  initDb();
  cleanupConfig = setupTestConfig().cleanup;
});

afterEach(() => {
  cleanupConfig();
});

describe("workflowHandlers", () => {
  it("loads workflow YAML by matching template id even when filename differs", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const workflowsDir = join(configDir, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    const filePath = join(workflowsDir, "open-spec.yaml");
    writeFileSync(
      filePath,
      [
        "id: openspec",
        "name: Open Spec",
        "columns:",
        "  - id: backlog",
        "    label: Backlog",
      ].join("\n"),
      "utf-8",
    );

    const handlers = workflowHandlers(() => {});
    const result = await handlers["workflow.getYaml"]({ templateId: "openspec" });

    expect(result.yaml).toContain("id: openspec");
    expect(result.yaml).toContain("name: Open Spec");
  });
});
