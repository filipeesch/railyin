import { Database } from "bun:sqlite";

export function hasColumn(db: Database, tableName: string, columnName: string): boolean {
  const columns = db.query<Record<string, unknown>, []>(`PRAGMA table_info(${tableName})`).all();
  return columns.some((col) => String(col.name ?? "") === columnName);
}

export function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return row !== null;
}
