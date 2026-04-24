import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setupTestConfig } from "./helpers.ts";
import { workspaceHandlers } from "../handlers/workspace.ts";
import { getWorkspaceRegistry, loadConfig, resetConfig } from "../config/index.ts";

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

  it("allows anthropic and lsp blocks with supported engines", async () => {
    const configDir = process.env.RAILYN_CONFIG_DIR!;
    const workspaceFileName = process.env.RAILYN_DB === ":memory:" ? "workspace.test.yaml" : "workspace.yaml";
    writeFileSync(
      join(configDir, workspaceFileName),
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        "anthropic:",
        "  enable_thinking: true",
        "lsp:",
        "  servers:",
        "    - name: typescript-language-server",
        "      command: typescript-language-server",
        "      args: ['--stdio']",
        "      extensions: ['.ts']",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        "    project_path: /tmp/test-git",
        "    git_root_path: /tmp/test-git",
        "    default_branch: main",
      ].join("\n"),
      "utf-8",
    );
    resetConfig();

    const handlers = workspaceHandlers();
    const result = await handlers["workspace.getConfig"]({});

    expect(result.enableThinking).toBe(true);
    expect(result.key).toBe("default");
  });

  it("creates the default workspace only under the workspaces root", () => {
    cleanupConfig();

    const dataDir = mkdtempSync(join(tmpdir(), "railyn-data-"));
    const workspacesDir = join(dataDir, "workspaces");
    process.env.RAILYN_DATA_DIR = dataDir;
    process.env.RAILYN_DB = ":memory:";
    delete process.env.RAILYN_CONFIG_DIR;

    resetConfig();
    const result = loadConfig();
    const registry = getWorkspaceRegistry();
    const workspaceFile = join(workspacesDir, "default", "workspace.test.yaml");

    expect(result.error).toBeNull();
    expect(registry).toHaveLength(1);
    expect(registry[0]?.configDir).toBe(join(workspacesDir, "default"));
    expect(existsSync(workspaceFile)).toBe(true);
    expect(readFileSync(workspaceFile, "utf-8")).toContain("type: copilot");

    rmSync(dataDir, { recursive: true, force: true });
    delete process.env.RAILYN_DATA_DIR;
    delete process.env.RAILYN_DB;
    resetConfig();
    cleanupConfig = setupTestConfig().cleanup;
  });
});
