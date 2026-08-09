import type { Database } from "bun:sqlite";
import { getDb } from "../index.ts";

// ─── Scope ────────────────────────────────────────────────────────────────────

export type ShellApprovalScope =
  | { kind: "task"; taskId: number }
  | { kind: "chat"; conversationId: number };

// ─── Repository ───────────────────────────────────────────────────────────────

export interface ShellApprovalState {
  shellAutoApprove: boolean;
}

/**
 * Reads the per-scope shell_auto_approve flag. The opencode engine (A3
 * posture) uses this to answer permission requests deterministically —
 * auto-approve when set, deny otherwise. The per-command approval machinery
 * (parseShellBinaries / approved_commands matching) was trimmed with the
 * shell_approval EngineEvent channel (07-02).
 */
export class ShellApprovalRepository {
  private readonly db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDb();
  }

  getState(scope: ShellApprovalScope): ShellApprovalState {
    if (scope.kind === "task") {
      const row = this.db
        .query<{ shell_auto_approve: number }, [number]>(
          "SELECT shell_auto_approve FROM tasks WHERE id = ?",
        )
        .get(scope.taskId);
      return { shellAutoApprove: row?.shell_auto_approve === 1 };
    }

    const row = this.db
      .query<{ shell_auto_approve: number }, [number]>(
        "SELECT shell_auto_approve FROM chat_sessions WHERE conversation_id = ?",
      )
      .get(scope.conversationId);
    return { shellAutoApprove: row?.shell_auto_approve === 1 };
  }
}
