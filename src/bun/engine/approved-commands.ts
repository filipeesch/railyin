import { getDb } from "../db/index.ts";

export function getApprovedCommands(taskId: number): string[] {
  const db = getDb();
  const row = db.query<{ approved_commands: string }, [number]>(
    "SELECT approved_commands FROM tasks WHERE id = ?",
  ).get(taskId);
  try {
    return JSON.parse(row?.approved_commands ?? "[]");
  } catch {
    return [];
  }
}

export function appendApprovedCommands(taskId: number, binaries: string[]): void {
  const current = getApprovedCommands(taskId);
  const updated = [...new Set([...current, ...binaries])];
  const db = getDb();
  db.run("UPDATE tasks SET approved_commands = ? WHERE id = ?", [JSON.stringify(updated), taskId]);
}
