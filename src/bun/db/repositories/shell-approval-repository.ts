import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

// ─── Scope ────────────────────────────────────────────────────────────────────

export type ShellApprovalScope =
  | { kind: "task"; taskId: number }
  | { kind: "chat"; conversationId: number };

// ─── Pure utilities (no DB dependency) ───────────────────────────────────────

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

export function getUnapprovedShellBinaries(command: string, approvedCommands: string[]): string[] {
  return parseShellBinaries(command).filter((binary) => !approvedCommands.includes(binary));
}

// ─── Repository ───────────────────────────────────────────────────────────────

export interface ShellApprovalState {
  shellAutoApprove: boolean;
  approvedCommands: string[];
}

export class ShellApprovalRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  getState(scope: ShellApprovalScope): ShellApprovalState {
    if (scope.kind === "task") {
      const row = this.db
        .query<{ shell_auto_approve: number; approved_commands: string }, [number]>(
          "SELECT shell_auto_approve, approved_commands FROM tasks WHERE id = ?",
        )
        .get(scope.taskId);
      return {
        shellAutoApprove: row?.shell_auto_approve === 1,
        approvedCommands: this._parseCommands(row?.approved_commands),
      };
    }

    const row = this.db
      .query<{ shell_auto_approve: number; approved_commands: string }, [number]>(
        "SELECT shell_auto_approve, approved_commands FROM chat_sessions WHERE conversation_id = ?",
      )
      .get(scope.conversationId);
    return {
      shellAutoApprove: row?.shell_auto_approve === 1,
      approvedCommands: this._parseCommands(row?.approved_commands),
    };
  }

  appendApprovedCommands(scope: ShellApprovalScope, binaries: string[]): void {
    const current = this.getState(scope).approvedCommands;
    const updated = JSON.stringify([...new Set([...current, ...binaries])]);

    if (scope.kind === "task") {
      this.db.run("UPDATE tasks SET approved_commands = ? WHERE id = ?", [updated, scope.taskId]);
    } else {
      this.db.run(
        "UPDATE chat_sessions SET approved_commands = ? WHERE conversation_id = ?",
        [updated, scope.conversationId],
      );
    }
  }

  private _parseCommands(raw: string | null | undefined): string[] {
    try {
      return JSON.parse(raw ?? "[]");
    } catch {
      return [];
    }
  }
}
