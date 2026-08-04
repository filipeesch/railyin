import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isDockerAvailable, pgTestContainer, type PgFixture } from "./pg-test-container.ts";
import { runPostgresMigrations, type MigrationLogger } from "../../db/migrations/runner.ts";

const silentLogger: MigrationLogger = { info() {}, warn() {} };

describe.skipIf(!isDockerAvailable())("PostgreSQL core-flow parity (PC-5)", () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await pgTestContainer();
    await runPostgresMigrations(fixture.db, silentLogger);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("PG-F1: task -> conversation -> execution -> decision -> note flow works end-to-end", async () => {
    const board = await fixture.db.get<{ id: number }>(
      "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, $2, $3) RETURNING id",
      ["default", "pg-board", "delivery"],
    );
    const conversation = await fixture.db.get<{ id: number }>(
      "INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id",
    );
    const task = await fixture.db.get<{ id: number }>(
      "INSERT INTO tasks (board_id, project_key, title, conversation_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [board!.id, "pg-project", "PG task", conversation!.id],
    );
    await fixture.db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [task!.id, conversation!.id]);

    const execution = await fixture.db.get<{ id: number }>(
      "INSERT INTO executions (task_id, conversation_id, from_state, to_state) VALUES ($1, $2, 'backlog', 'plan') RETURNING id",
      [task!.id, conversation!.id],
    );
    expect(execution?.id).toBeGreaterThan(0);

    const decision = await fixture.db.get<{ id: number }>(
      "INSERT INTO decision_records (conversation_id, question, answer) VALUES ($1, $2, $3) RETURNING id",
      [conversation!.id, "Architecture?", "Monolith"],
    );
    expect(decision?.id).toBeGreaterThan(0);

    const note = await fixture.db.get<{ id: number }>(
      "INSERT INTO task_notes (conversation_id, content) VALUES ($1, $2) RETURNING id",
      [conversation!.id, "A note"],
    );
    expect(note?.id).toBeGreaterThan(0);

    const fetchedTask = await fixture.db.get<{ title: string; conversation_id: number }>(
      "SELECT title, conversation_id FROM tasks WHERE id = $1",
      [task!.id],
    );
    expect(fetchedTask?.title).toBe("PG task");
    expect(fetchedTask?.conversation_id).toBe(conversation!.id);
  });

  it("PG-F2: ON CONFLICT DO NOTHING upsert parity — enabled_models", async () => {
    await fixture.db.exec(
      "INSERT INTO enabled_models (workspace_key, qualified_model_id) VALUES ($1, $2) ON CONFLICT (workspace_key, qualified_model_id) DO NOTHING",
      ["default", "anthropic/claude"],
    );
    // Second insert with the same key is a no-op, not an error.
    await fixture.db.exec(
      "INSERT INTO enabled_models (workspace_key, qualified_model_id) VALUES ($1, $2) ON CONFLICT (workspace_key, qualified_model_id) DO NOTHING",
      ["default", "anthropic/claude"],
    );
    const rows = await fixture.db.rows(
      "SELECT * FROM enabled_models WHERE workspace_key = $1 AND qualified_model_id = $2",
      ["default", "anthropic/claude"],
    );
    expect(rows.length).toBe(1);
  });

  it("PG-F3: ON CONFLICT DO NOTHING upsert parity — stream_events (conversation_id, seq)", async () => {
    const conversation = await fixture.db.get<{ id: number }>(
      "INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id",
    );
    const insertOne = () =>
      fixture.db.exec(
        `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (conversation_id, seq) DO NOTHING`,
        [conversation!.id, 1, 1, "b1", "text", "hello"],
      );
    await insertOne();
    await insertOne();
    const rows = await fixture.db.rows(
      "SELECT * FROM stream_events WHERE conversation_id = $1 AND seq = $2",
      [conversation!.id, 1],
    );
    expect(rows.length).toBe(1);
  });
});

describe.skipIf(!isDockerAvailable())("PostgreSQL connection pool configuration (PC-5)", () => {
  it("PG-P1: pool.max is respected — concurrent queries beyond the limit still complete", async () => {
    const fixture = await pgTestContainer();
    try {
      await runPostgresMigrations(fixture.db, silentLogger);
      // 20 concurrent queries against a max=5 pool (set in pgTestContainer) should
      // all resolve correctly (queued, not dropped or corrupted).
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => fixture.db.get<{ n: number }>("SELECT $1::int as n", [i])),
      );
      expect(results.map((r) => r?.n).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        Array.from({ length: 20 }, (_, i) => i),
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
