import { getDb } from "../db/index.ts";

/**
 * Extract all command binaries from a compound shell command, including those
 * after pipe operators (inclusive semantics). Splits on &&, ||, |, and ;.
 */
export function parseShellBinaries(command: string): string[] {
  const segments = command.split(/&&|\|\||[|;]/);
  const binaries: string[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const token = trimmed.split(/\s+/)[0];
    if (token && !binaries.includes(token)) {
      binaries.push(token);
    }
  }
  return binaries;
}

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
