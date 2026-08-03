import { describe, it, expect } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb } from "./helpers.ts";
import { FakeDb } from "./fixtures/fake-db.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";

describe("Db port (PC-2, real in-memory SQLite)", () => {
  it("DP-1: rows returns a typed array, empty array (not undefined) when no rows match", async () => {
    const db: Db = await initDb();
    const rows = await db.rows<{ id: number }>("SELECT id FROM boards WHERE id = $1", [999999]);
    expect(rows).toEqual([]);
  });

  it("DP-2: get returns undefined (not null) when no row matches", async () => {
    const db: Db = await initDb();
    const row = await db.get("SELECT id FROM boards WHERE id = $1", [999999]);
    expect(row).toBeUndefined();
  });

  it("DP-3: $1 parameters are bound, not interpolated", async () => {
    const db: Db = await initDb();
    const malicious = "x'; DROP TABLE boards; --";
    await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3)", [
      "default",
      malicious,
      "delivery",
    ]);
    const row = await db.get<{ name: string }>("SELECT name FROM boards WHERE name = $1", [malicious]);
    expect(row?.name).toBe(malicious);
    // Table still exists — no injection occurred.
    const stillThere = await db.rows("SELECT 1 as x FROM boards LIMIT 1");
    expect(stillThere.length).toBe(1);
  });

  it("DP-4: begin commits both writes on success", async () => {
    const db: Db = await initDb();
    await db.begin(async (tx) => {
      await tx.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1,$2,$3)", [
        "default",
        "A",
        "delivery",
      ]);
      await tx.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1,$2,$3)", [
        "default",
        "B",
        "delivery",
      ]);
    });
    const count = await db.get<{ c: number }>("SELECT count(*) as c FROM boards WHERE name IN ($1,$2)", ["A", "B"]);
    expect(Number(count?.c)).toBe(2);
  });

  it("DP-5: begin rolls back both writes when the callback throws", async () => {
    const db: Db = await initDb();
    await expect(
      db.begin(async (tx) => {
        await tx.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1,$2,$3)", [
          "default",
          "Rollback1",
          "delivery",
        ]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const count = await db.get<{ c: number }>("SELECT count(*) as c FROM boards WHERE name = $1", ["Rollback1"]);
    expect(Number(count?.c)).toBe(0);
  });

  it("DP-6: exec on a write reports affectedRows and lastInsertRowid", async () => {
    const db: Db = await initDb();
    const res = await db.exec("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1,$2,$3)", [
      "default",
      "C",
      "delivery",
    ]);
    expect(res.affectedRows).toBe(1);
    expect(res.lastInsertRowid).toBeGreaterThan(0);
  });

  it("DP-10: dialect.jsonExtract() reads a nested JSON field on real SQLite (pairs with the PG dialect-execution assertions)", async () => {
    const db: Db = await initDb();
    const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id");
    await db.exec("INSERT INTO conversation_messages (conversation_id, type, metadata) VALUES ($1, $2, $3)", [
      conv!.id,
      "text",
      JSON.stringify({ a: { b: "nested-value" } }),
    ]);
    const row = await db.get<{ v: string }>(
      `SELECT ${db.dialect.jsonExtract("metadata", "a.b")} as v FROM conversation_messages WHERE conversation_id = $1`,
      [conv!.id],
    );
    expect(row?.v).toBe("nested-value");
  });

  it("DP-11: boolean-like flag round-trips as 0/1 on real SQLite (pairs with the PG dialect-execution assertions)", async () => {
    const db: Db = await initDb();
    await db.exec("INSERT INTO tasks (board_id, project_key, title, shell_auto_approve) VALUES ($1,$2,$3,$4)", [
      (await db.get<{ id: number }>(
        "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1,$2,$3) RETURNING id",
        ["default", "BoolBoard", "delivery"],
      ))!.id,
      "p",
      "Bool task",
      db.dialect.toDbBool(true),
    ]);
    const row = await db.get<{ shell_auto_approve: number }>(
      "SELECT shell_auto_approve FROM tasks WHERE title = $1",
      ["Bool task"],
    );
    expect(db.dialect.fromDbBool(row?.shell_auto_approve)).toBe(true);
  });
});

describe("Provider + constructor DI (PC-4)", () => {
  it("DP-7: repository constructed with a FakeDb never touches a real database", async () => {
    const fake = new FakeDb();
    const row = {
      id: 1,
      conversation_id: 5,
      batch_id: null,
      question: "Q",
      answer: "A",
      weight: "medium",
      notes: null,
      revision_count: 0,
      is_source_ai: 0,
      is_deleted: 0,
      created_at: "now",
      updated_at: "now",
    };
    fake.primeExec({});
    fake.primeRows([row]);
    const repo = new DecisionRepository(fake);
    const record = await repo.createRecord(5, { question: "Q", answer: "A" });
    expect(record.question).toBe("Q");
    expect(fake.calls.length).toBe(2);
    expect(fake.calls[0]?.op).toBe("exec");
    expect(fake.calls[0]?.text).toContain("INSERT INTO decision_records");
    expect(fake.calls[1]?.op).toBe("get");
  });

  it("DP-8: FakeDb records exact SQL text and bound params for assertion", async () => {
    const fake = new FakeDb();
    fake.primeRows([{ id: 1 }]);
    await fake.get("SELECT id FROM tasks WHERE id = $1", [42]);
    expect(fake.calls).toEqual([{ op: "get", text: "SELECT id FROM tasks WHERE id = $1", params: [42] }]);
  });

  it("DP-9: FakeDb distinguishes rows vs get vs exec operations", async () => {
    const fake = new FakeDb();
    fake.primeRows([{ a: 1 }]);
    fake.primeRows([{ a: 2 }]);
    fake.primeExec({ affectedRows: 3 });
    await fake.rows("SELECT 1");
    await fake.get("SELECT 2");
    await fake.exec("UPDATE t SET x = 1");
    expect(fake.calls.map((c) => c.op)).toEqual(["rows", "get", "exec"]);
  });
});
