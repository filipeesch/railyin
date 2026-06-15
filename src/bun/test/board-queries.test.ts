import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initDb, makeTempDir } from "@bun/test/helpers.ts";
import { listBoardsByWorkspace } from "@bun/db/board-queries.ts";

describe("listBoardsByWorkspace", () => {
  describe("returns correct boards ordered by creation time", () => {
    it("returns boards in ASC order by created_at", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        // Insert boards in reverse order
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Board C", "delivery"]);
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Board B", "delivery"]);
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Board A", "delivery"]);

        const result = listBoardsByWorkspace(db);
        expect(result).toHaveLength(3);
        expect(result[0]!.name).toBe("Board C");
        expect(result[1]!.name).toBe("Board B");
        expect(result[2]!.name).toBe("Board A");
      } finally {
        cleanup();
      }
    });
  });

  describe("filters by workspace key", () => {
    it("returns only boards matching the workspace key", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Default Board", "delivery"]);
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["other", "Other Board", "delivery"]);
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Another Default", "delivery"]);

        const result = listBoardsByWorkspace(db, "default");
        expect(result).toHaveLength(2);
        expect(result.every((b) => b.workspace_key === "default")).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("returns empty when no boards match the workspace key", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Default Board", "delivery"]);

        const result = listBoardsByWorkspace(db, "nonexistent");
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });

  describe("returns empty array when no boards", () => {
    it("returns empty array for empty workspace", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        const result = listBoardsByWorkspace(db);
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it("returns empty array when filtering by workspace key with no boards", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        const result = listBoardsByWorkspace(db, "default");
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });

  describe("returns correct fields", () => {
    it("includes id, name, and workspace_key", () => {
      const db = initDb();
      const { cleanup } = makeTempDir();

      try {
        db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES (?, ?, ?)", ["default", "Test Board", "delivery"]);

        const result = listBoardsByWorkspace(db);
        expect(result).toHaveLength(1);
        expect(result[0]!).toHaveProperty("id");
        expect(result[0]!).toHaveProperty("name", "Test Board");
        expect(result[0]!).toHaveProperty("workspace_key", "default");
      } finally {
        cleanup();
      }
    });
  });
});
