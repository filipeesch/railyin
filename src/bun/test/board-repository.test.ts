import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb } from "./helpers.ts";
import { BoardRepository, type IBoardRepository } from "../db/board-repository.ts";

let db: Database;
let repo: BoardRepository;

beforeEach(() => {
  db = initDb();
  repo = new BoardRepository(db);
});

describe("BR-1: Interface contract", () => {
  it("IBoardRepository defines all 4 methods", () => {
    const r: IBoardRepository = new BoardRepository(db);
    expect(typeof r.listByWorkspace).toBe("function");
    expect(typeof r.getById).toBe("function");
    expect(typeof r.exists).toBe("function");
    expect(typeof r.getWorkspaceKey).toBe("function");
  });

  it("BoardRepository satisfies IBoardRepository", () => {
    const r: IBoardRepository = repo;
    expect(r).toBeDefined();
  });
});

describe("BR-2: listByWorkspace", () => {
  it("returns boards for workspace", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'Board A', 'delivery')");
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'Board B', 'delivery')");
    const result = repo.listByWorkspace("default");
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
  });

  it("returns empty array for empty workspace", () => {
    const result = repo.listByWorkspace("empty");
    expect(result).toEqual([]);
  });

  it("orders by created_at ascending", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id, created_at) VALUES ('default', 'First', 'delivery', '2024-01-01')");
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id, created_at) VALUES ('default', 'Second', 'delivery', '2024-01-02')");
    const result = repo.listByWorkspace("default");
    expect(result[0]!.name).toBe("First");
    expect(result[1]!.name).toBe("Second");
  });

  it("cross-workspace isolation", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('ws1', 'Board 1', 'delivery')");
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('ws2', 'Board 2', 'delivery')");
    const result = repo.listByWorkspace("ws1");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Board 1");
  });
});

describe("BR-3: getById", () => {
  it("returns board data for known id", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'Test', 'delivery')");
    const id = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    const result = repo.getById(id);
    expect(result).toEqual({
      id,
      name: "Test",
      workspaceKey: "default",
    });
  });

  it("returns null for unknown id", () => {
    expect(repo.getById(999)).toBeNull();
  });
});

describe("BR-4: exists", () => {
  it("returns true for known board", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'Test', 'delivery')");
    const id = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    expect(repo.exists(id)).toBe(true);
  });

  it("returns false for unknown board", () => {
    expect(repo.exists(999)).toBe(false);
  });
});

describe("BR-5: getWorkspaceKey", () => {
  it("returns workspace key for known board", () => {
    db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('my-ws', 'Test', 'delivery')");
    const id = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    expect(repo.getWorkspaceKey(id)).toBe("my-ws");
  });

  it("returns null for unknown board", () => {
    expect(repo.getWorkspaceKey(999)).toBeNull();
  });
});
