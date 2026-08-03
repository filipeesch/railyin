import type { Db } from "../db.ts";
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
  private readonly db: Db;

  constructor(db?: Db) {
    this.db = db ?? getDb();
  }

  async getState(scope: ShellApprovalScope): Promise<ShellApprovalState> {
    if (scope.kind === "task") {
      const row = await this.db.get<{ shell_auto_approve: number; approved_commands: string }>(
        "SELECT shell_auto_approve, approved_commands FROM tasks WHERE id = $1",
        [scope.taskId],
      );
      return {
        shellAutoApprove: row?.shell_auto_approve === 1,
        approvedCommands: this._parseCommands(row?.approved_commands),
      };
    }

    const row = await this.db.get<{ shell_auto_approve: number; approved_commands: string }>(
      "SELECT shell_auto_approve, approved_commands FROM chat_sessions WHERE conversation_id = $1",
      [scope.conversationId],
    );
    return {
      shellAutoApprove: row?.shell_auto_approve === 1,
      approvedCommands: this._parseCommands(row?.approved_commands),
    };
  }

  async appendApprovedCommands(scope: ShellApprovalScope, binaries: string[]): Promise<void> {
    const current = (await this.getState(scope)).approvedCommands;
    const updated = JSON.stringify([...new Set([...current, ...binaries])]);

    if (scope.kind === "task") {
      await this.db.exec("UPDATE tasks SET approved_commands = $1 WHERE id = $2", [updated, scope.taskId]);
    } else {
      await this.db.exec(
        "UPDATE chat_sessions SET approved_commands = $1 WHERE conversation_id = $2",
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
