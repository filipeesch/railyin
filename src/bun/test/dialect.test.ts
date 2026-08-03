import { describe, it, expect } from "vitest";
import { SqliteDialect, PostgresDialect } from "../db/dialect.ts";

describe("Dialect fragments (PC-3, pure — no DB)", () => {
  const sqlite = new SqliteDialect();
  const postgres = new PostgresDialect();

  it("DL-1: now() differs per dialect", () => {
    expect(sqlite.now()).toBe("datetime('now')");
    expect(postgres.now()).toContain("now()");
    expect(sqlite.now()).not.toBe(postgres.now());
  });

  it("DL-2: intervalAgo() differs per dialect but both reference the amount/unit", () => {
    expect(sqlite.intervalAgo(7, "days")).toBe("datetime('now', '-7 days')");
    expect(postgres.intervalAgo(7, "days")).toContain("interval '7 days'");
  });

  it("DL-3: jsonExtract() differs per dialect (single segment)", () => {
    expect(sqlite.jsonExtract("metadata", "key")).toBe("json_extract(metadata, '$.key')");
    expect(postgres.jsonExtract("metadata", "key")).toBe("(metadata::jsonb ->> 'key')");
  });

  it("DL-4: jsonExtract() handles nested paths", () => {
    expect(sqlite.jsonExtract("metadata", "a.b")).toBe("json_extract(metadata, '$.a.b')");
    expect(postgres.jsonExtract("metadata", "a.b")).toBe("(metadata::jsonb #>> '{a,b}')");
  });

  it("DL-5: returningId() emits a RETURNING clause with the default id column", () => {
    expect(sqlite.returningId()).toContain("RETURNING id");
    expect(postgres.returningId()).toContain("RETURNING id");
  });

  it("DL-6: returningId() honors a custom id column name", () => {
    expect(sqlite.returningId("uuid")).toContain("RETURNING uuid");
    expect(postgres.returningId("uuid")).toContain("RETURNING uuid");
  });

  it("DL-7: boolean mapping round-trips true/false on both dialects", () => {
    for (const dialect of [sqlite, postgres]) {
      expect(dialect.toDbBool(true)).toBe(1);
      expect(dialect.toDbBool(false)).toBe(0);
      expect(dialect.fromDbBool(1)).toBe(true);
      expect(dialect.fromDbBool(0)).toBe(false);
    }
  });

  it("DL-8: fromDbBool tolerates native Postgres boolean/text representations", () => {
    expect(postgres.fromDbBool(true)).toBe(true);
    expect(postgres.fromDbBool(false)).toBe(false);
    expect(postgres.fromDbBool("t")).toBe(true);
    expect(postgres.fromDbBool("f")).toBe(false);
  });

  it("DL-9: kind identifies the dialect", () => {
    expect(sqlite.kind).toBe("sqlite");
    expect(postgres.kind).toBe("postgres");
  });
});
