import { getDb } from "./db/index.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogOptions {
  taskId?: number;
  executionId?: number;
  data?: unknown;
}

/**
 * Write a structured log entry to the `logs` table and echo to stdout.
 * Query examples:
 *   SELECT * FROM logs WHERE task_id = 16 ORDER BY id DESC;
 *   SELECT * FROM logs WHERE level = 'error';
 *   SELECT * FROM logs WHERE execution_id = 103;
 */
export function log(level: LogLevel, message: string, opts?: LogOptions): void {
  const db = getDb();
  db.run(
    "INSERT INTO logs (level, task_id, execution_id, message, data) VALUES (?, ?, ?, ?, ?)",
    [
      level,
      opts?.taskId ?? null,
      opts?.executionId ?? null,
      message,
      opts?.data !== undefined ? JSON.stringify(opts.data) : null,
    ],
  );

  const parts: string[] = [`[${level.toUpperCase()}]`];
  if (opts?.taskId != null) parts.push(`task=${opts.taskId}`);
  if (opts?.executionId != null) parts.push(`exec=${opts.executionId}`);
  parts.push(message);
  console.log(parts.join(" "));
}
