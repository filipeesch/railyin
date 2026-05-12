import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, setupTestConfig } from "./helpers.ts";
import { getColumnConfig, getWorkflowTemplate } from "../workflow/column-config.ts";
import { getConfig } from "../config/index.ts";

let db: Database;
let configCleanup: () => void;

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  configCleanup();
});

describe("getColumnConfig", () => {
  it("returns the column object when board and column both exist", () => {
    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const col = getColumnConfig(config, boardId, "plan");

    expect(col).not.toBeNull();
    expect(col!.id).toBe("plan");
  });

  it("falls back to the 'delivery' template when boardId is not in the database", () => {
    const config = getConfig();

    // board not found → templateId defaults to "delivery", so a known column is still found
    const col = getColumnConfig(config, 99999, "plan");

    expect(col).not.toBeNull();
    expect(col!.id).toBe("plan");
  });

  it("returns null when board exists but columnId is not in the workflow template", () => {
    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const col = getColumnConfig(config, boardId, "nonexistent-column");

    expect(col).toBeNull();
  });

  it("falls back to 'delivery' template when board has no matching template", () => {
    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'unknown-template')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const col = getColumnConfig(config, boardId, "backlog");

    expect(col).toBeNull();
  });
});

describe("getWorkflowTemplate", () => {
  it("returns the template for a board with a known template", () => {
    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const tmpl = getWorkflowTemplate(config, boardId);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe("delivery");
  });

  it("falls back to 'delivery' template when board is not found", () => {
    const config = getConfig();

    const tmpl = getWorkflowTemplate(config, 99999);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.id).toBe("delivery");
  });

  it("returns null when board has an unknown template id", () => {
    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'nonexistent')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const tmpl = getWorkflowTemplate(config, boardId);

    expect(tmpl).toBeNull();
  });

  it("returns workflow_instructions field when set on the template", () => {
    const wfYaml = `id: wf-with-instructions
name: With Instructions
workflow_instructions: "Always be helpful."
columns:
  - id: todo
    label: Todo
`;
    const { cleanup } = setupTestConfig("", "/tmp/test-git", [wfYaml]);
    configCleanup = cleanup;

    db.run(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'wf-with-instructions')",
    );
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!.id;
    const config = getConfig();

    const tmpl = getWorkflowTemplate(config, boardId);

    expect(tmpl).not.toBeNull();
    expect(tmpl!.workflow_instructions).toBe("Always be helpful.");
  });
});

