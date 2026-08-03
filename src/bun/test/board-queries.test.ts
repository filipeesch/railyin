import { describe, it, expect } from "bun:test";
import { initDb, makeTempDir } from "@bun/test/helpers.ts";
import { listBoardsByWorkspace } from "@bun/db/board-queries.ts";

describe("listBoardsByWorkspace", () => {
  describe("returns correct boards ordered by creation time", () => {
    it("returns boards in ASC order by created_at", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        // Insert boards in reverse order
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Board C", "delivery"]);
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Board B", "delivery"]);
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Board A", "delivery"]);

        const result = await listBoardsByWorkspace(db);
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
    it("returns only boards matching the workspace key", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Default Board", "delivery"]);
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["other", "Other Board", "delivery"]);
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Another Default", "delivery"]);

        const result = await listBoardsByWorkspace(db, "default");
        expect(result).toHaveLength(2);
        expect(result.every((b) => b.workspace_key === "default")).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("returns empty when no boards match the workspace key", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Default Board", "delivery"]);

        const result = await listBoardsByWorkspace(db, "nonexistent");
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });

  describe("returns empty array when no boards", () => {
    it("returns empty array for empty workspace", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        const result = await listBoardsByWorkspace(db);
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });

    it("returns empty array when filtering by workspace key with no boards", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        const result = await listBoardsByWorkspace(db, "default");
        expect(result).toHaveLength(0);
      } finally {
        cleanup();
      }
    });
  });

  describe("returns correct fields", () => {
    it("includes id, name, and workspace_key", async () => {
      const db = await initDb();
      const { cleanup } = makeTempDir();

      try {
        await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", ["default", "Test Board", "delivery"]);

        const result = await listBoardsByWorkspace(db);
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
