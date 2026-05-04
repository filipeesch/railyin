import type { Database } from "bun:sqlite";
import { hasColumn } from "./_utils.ts";

export const id = "037_remove_model_from_tasks";

export function up(db: Database): void {
  // SQLite doesn't support DROP COLUMN directly (before version 3.35.0),
  // so we need to recreate the table without the model column.

  // First, check if the tasks table exists
  const tableExists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get();
  
  if (!tableExists) {
    // Table doesn't exist, nothing to do
    return;
  }

  // Check if the model column exists
  if (!hasColumn(db, "tasks", "model")) {
    // Column already doesn't exist, nothing to do
    return;
  }

  // Get the current schema of tasks table
  const tableInfo = db.query<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }, []>(
    "PRAGMA table_info(tasks)"
  ).all();

  // Build column definitions for the new table (excluding model column)
  const columnDefs: string[] = [];
  for (const col of tableInfo) {
    if (col.name === "model") continue; // Skip the model column

    let colDef = `${col.name} ${col.type}`;

    if (col.notnull === 1) {
      colDef += " NOT NULL";
    }

    // Only add DEFAULT if it's not a function call (which would have parentheses)
    // Function defaults like datetime('now') cause syntax errors in CREATE TABLE
    if (col.dflt_value !== null && !col.dflt_value.includes('(')) {
      colDef += ` DEFAULT ${col.dflt_value}`;
    }

    if (col.pk === 1) {
      // For AUTOINCREMENT, we need to check if it's an INTEGER PRIMARY KEY
      // SQLite only allows AUTOINCREMENT on INTEGER PRIMARY KEY columns
      if (col.type.toUpperCase() === "INTEGER") {
        colDef += " PRIMARY KEY AUTOINCREMENT";
      } else {
        colDef += " PRIMARY KEY";
      }
    }

    columnDefs.push(colDef);
  }

  const columnsSql = columnDefs.join(", ");

  // Create new table without model column
  db.exec(`CREATE TABLE tasks_new (${columnsSql})`);

  // Copy data from old table to new table (excluding model column)
  const columnNames = tableInfo
    .filter(col => col.name !== "model")
    .map(col => col.name)
    .join(", ");

  db.exec(`INSERT INTO tasks_new (${columnNames}) SELECT ${columnNames} FROM tasks`);

  // Drop old table and rename new table
  db.exec("DROP TABLE tasks");
  db.exec("ALTER TABLE tasks_new RENAME TO tasks");
}

export function down(db: Database): void {
  // To restore the model column, we need to recreate the table with it
  // This is the reverse of the up migration

  // Get the current schema of tasks table
  const tableInfo = db.query<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }, []>(
    "PRAGMA table_info(tasks)"
  ).all();

  // Build column definitions for the new table (including model column)
  const columnDefs: string[] = [];
  for (const col of tableInfo) {
    let colDef = `${col.name} ${col.type}`;

    if (col.notnull === 1) {
      colDef += " NOT NULL";
    }

    // Only add DEFAULT if it's not a function call (which would have parentheses)
    if (col.dflt_value !== null && !col.dflt_value.includes('(')) {
      colDef += ` DEFAULT ${col.dflt_value}`;
    }

    if (col.pk === 1) {
      if (col.type.toUpperCase() === "INTEGER") {
        colDef += " PRIMARY KEY AUTOINCREMENT";
      } else {
        colDef += " PRIMARY KEY";
      }
    }

    columnDefs.push(colDef);
  }

  // Add the model column at the end
  columnDefs.push("model TEXT");

  const columnsSql = columnDefs.join(", ");

  // Create new table with model column
  db.exec(`CREATE TABLE tasks_new (${columnsSql})`);

  // Copy data from old table to new table
  const columnNames = tableInfo
    .map(col => col.name)
    .join(", ");

  db.exec(`INSERT INTO tasks_new (${columnNames}) SELECT ${columnNames} FROM tasks`);

  // Drop old table and rename new table
  db.exec("DROP TABLE tasks");
  db.exec("ALTER TABLE tasks_new RENAME TO tasks");
}
