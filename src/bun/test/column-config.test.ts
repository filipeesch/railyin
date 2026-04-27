import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, setupTestConfig } from "./helpers.ts";
import { getColumnConfig } from "../workflow/column-config.ts";
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
