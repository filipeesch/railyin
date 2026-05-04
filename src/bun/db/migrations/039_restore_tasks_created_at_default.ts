import type { Database } from "bun:sqlite";

export const id = "039_restore_tasks_created_at_default";
// Must manage its own transaction so we can toggle PRAGMA foreign_keys
// (SQLite forbids changing it inside an active transaction).
export const managesTransaction = true;

// Migration 037 (remove_model_from_tasks) recreated the tasks table but
// accidentally dropped the DEFAULT (datetime('now')) from the created_at column
// because it skipped function-call defaults. This migration recreates the table
// with the correct default restored.
export function up(db: Database): void {
  // Check whether created_at already has its default (i.e. 037 ran cleanly or
  // this database was created fresh after the fix).
  type ColRow = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
  const tableInfo = db.query<ColRow, []>("PRAGMA table_info(tasks)").all();

  if (tableInfo.length === 0) {
    // No tasks table yet — record as applied and bail.
    db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    return;
  }

  const createdAt = tableInfo.find(c => c.name === "created_at");
  if (createdAt?.dflt_value !== null) {
    // Default already present, nothing to do.
    db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    return;
  }

  // Disable FK enforcement so we can swap the table without FK violations.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    const columnDefs: string[] = [];
    for (const c of tableInfo) {
      // Restore the known default for created_at if it's missing
      const dflt = c.name === "created_at" && c.dflt_value === null
        ? "(datetime('now'))"
        : c.dflt_value;

      let colDef = `${c.name} ${c.type}`;
      if (c.notnull === 1) colDef += " NOT NULL";
      if (dflt !== null) colDef += ` DEFAULT ${dflt}`;
      if (c.pk === 1) {
        colDef += c.type.toUpperCase() === "INTEGER"
          ? " PRIMARY KEY AUTOINCREMENT"
          : " PRIMARY KEY";
      }
      columnDefs.push(colDef);
    }

    const columnsSql = columnDefs.join(", ");
    const columnNames = tableInfo.map(c => c.name).join(", ");

    db.transaction(() => {
      db.exec(`CREATE TABLE tasks_new (${columnsSql})`);
      db.exec(`INSERT INTO tasks_new (${columnNames}) SELECT ${columnNames} FROM tasks`);
      db.exec("DROP TABLE tasks");
      db.exec("ALTER TABLE tasks_new RENAME TO tasks");
      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function down(_db: Database): void {
  // No-op: restoring an intentional DEFAULT is safe to leave in place.
}
