import type { Database } from "bun:sqlite";

export const id = "056_drop_logs_table";

/**
 * Drops the legacy `logs` table. The table had no writes since structured
 * file logging replaced it; realLogger now emits JSON lines via console
 * (captured by server/file-logger.ts), so nothing references the table.
 */
export function up(db: Database): void {
  db.exec("DROP TABLE IF EXISTS logs");
}
