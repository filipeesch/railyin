import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, setupTestConfig } from "./helpers.ts";
import { getColumnConfig, getWorkflowTemplate } from "../workflow/column-config.ts";
import { getConfig } from "../config/index.ts";

let db: Db;
let configCleanup: () => void;

beforeEach(async () => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = await initDb();
});

afterEach(() => {
  configCleanup();
});

describe("getColumnConfig", () => {
  it("returns the column object when board and column both exist", async () => {
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id",
    ))!.id;
    const config = getConfig();

    const col = await getColumnConfig(config, boardId, "plan");

    expect(col).not.toBeNull();
    expect(col!.id).toBe("plan");
  });

  it("falls back to the 'delivery' template when boardId is not in the database", async () => {
    const config = getConfig();

    // board not found → templateId defaults to "delivery", so a known column is still found
    const col = await getColumnConfig(config, 99999, "plan");

    expect(col).not.toBeNull();
    expect(col!.id).toBe("plan");
  });

  it("returns null when board exists but columnId is not in the workflow template", async () => {
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id",
    ))!.id;
    const config = getConfig();

    const col = await getColumnConfig(config, boardId, "nonexistent-column");

    expect(col).toBeNull();
  });

  it("falls back to 'delivery' template when board has no matching template", async () => {
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'unknown-template') RETURNING id",
    ))!.id;
    const config = getConfig();

    const col = await getColumnConfig(config, boardId, "backlog");

    expect(col).toBeNull();
  });
});

describe("getWorkflowTemplate", () => {
  it("returns the template for a board with a known template", async () => {
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery') RETURNING id",
    ))!.id;
    const config = getConfig();

    const tmpl = await getWorkflowTemplate(config, boardId);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe("delivery");
  });

  it("falls back to 'delivery' template when board is not found", async () => {
    const config = getConfig();

    const tmpl = await getWorkflowTemplate(config, 99999);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe("delivery");
  });

  it("returns null when board has an unknown template id", async () => {
    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'nonexistent') RETURNING id",
    ))!.id;
    const config = getConfig();

    const tmpl = await getWorkflowTemplate(config, boardId);

    expect(tmpl).toBeNull();
  });

  it("returns workflow_instructions field when set on the template", async () => {
    const wfYaml = `id: wf-with-instructions
name: With Instructions
workflow_instructions: "Always be helpful."
columns:
  - id: todo
    label: Todo
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [wfYaml]);
    configCleanup = cleanup;

    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'wf-with-instructions') RETURNING id",
    ))!.id;
    const config = getConfig();

    const tmpl = await getWorkflowTemplate(config, boardId);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.workflow_instructions).toBe("Always be helpful.");
  });
});

describe("sampling_preset in column config", () => {
  // CC-PRESET-1: column with sampling_preset field is read correctly
  it("CC-PRESET-1: column with sampling_preset returns the preset name", async () => {
    const wfYaml = `id: wf-preset
name: WithPreset
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    on_enter_prompt: "do work"
    sampling_preset: balanced
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [wfYaml]);
    configCleanup = cleanup;

    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'wf-preset') RETURNING id",
    ))!.id;
    const config = getConfig();

    const col = await getColumnConfig(config, boardId, "plan");

    expect(col).not.toBeNull();
    expect(col!.sampling_preset).toBe("balanced");
  });

  // CC-PRESET-2: column without sampling_preset has undefined
  it("CC-PRESET-2: column without sampling_preset has undefined sampling_preset", async () => {
    const wfYaml = `id: wf-no-preset
name: NoPreset
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    on_enter_prompt: "do work"
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [wfYaml]);
    configCleanup = cleanup;

    const boardId = (await db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'wf-no-preset') RETURNING id",
    ))!.id;
    const config = getConfig();

    const col = await getColumnConfig(config, boardId, "plan");

    expect(col).not.toBeNull();
    expect(col!.sampling_preset).toBeUndefined();
  });

  // CC-PRESET-3: PiEngineConfig reads sampling_presets from engines.yaml
  it("CC-PRESET-3: PiEngineConfig.sampling_presets is loaded from engines.yaml", () => {
    const enginesYaml = `engines:
  - id: pi
    type: pi
    model: anthropic/claude-sonnet-4-5
    sampling_presets:
      balanced:
        temperature: 0.7
        top_p: 0.9
      creative:
        temperature: 1.2
        top_p: 0.95
        top_k: 40
    default_sampling_preset: balanced
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [], undefined, undefined, enginesYaml);
    configCleanup = cleanup;

    const config = getConfig();
    const piEntry = config.engines.find(e => e.id === "pi");
    const piConfig = piEntry!.config as import("../config/index.ts").PiEngineConfig;

    expect(piConfig.sampling_presets).toBeDefined();
    expect(piConfig.sampling_presets!["balanced"].temperature).toBe(0.7);
    expect(piConfig.sampling_presets!["creative"].top_k).toBe(40);
    expect(piConfig.default_sampling_preset).toBe("balanced");
  });

  // CC-PRESET-4: PiEngineConfig without presets has undefined fields
  it("CC-PRESET-4: PiEngineConfig without sampling_presets has undefined fields", () => {
    const enginesYaml = `engines:
  - id: pi
    type: pi
    model: anthropic/claude-sonnet-4-5
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [], undefined, undefined, enginesYaml);
    configCleanup = cleanup;

    const config = getConfig();
    const piEntry = config.engines.find(e => e.id === "pi");
    const piConfig = piEntry!.config as import("../config/index.ts").PiEngineConfig;

    expect(piConfig.sampling_presets).toBeUndefined();
    expect(piConfig.default_sampling_preset).toBeUndefined();
  });
});
