import type { Database } from "bun:sqlite";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ModelSettingsRepository {
  /** Returns the stored context window override for the given model, or null if none. */
  getContextWindow(workspaceKey: string, qualifiedModelId: string): number | null;
  /** Stores a context window override. Pass null to remove the override. */
  setContextWindow(workspaceKey: string, qualifiedModelId: string, value: number | null): void;
}

// ─── SQLite implementation ────────────────────────────────────────────────────

export class SqliteModelSettingsRepository implements ModelSettingsRepository {
  constructor(private readonly db: Database) {}

  getContextWindow(workspaceKey: string, qualifiedModelId: string): number | null {
    const row = this.db
      .query<{ context_window: number | null }, [string, string]>(
        "SELECT context_window FROM model_settings WHERE workspace_key = ? AND qualified_model_id = ?",
      )
      .get(workspaceKey, qualifiedModelId);
    return row?.context_window ?? null;
  }

  setContextWindow(workspaceKey: string, qualifiedModelId: string, value: number | null): void {
    if (value === null) {
      this.db.run(
        "DELETE FROM model_settings WHERE workspace_key = ? AND qualified_model_id = ?",
        [workspaceKey, qualifiedModelId],
      );
    } else {
      this.db.run(
        "INSERT INTO model_settings (workspace_key, qualified_model_id, context_window) VALUES (?, ?, ?) ON CONFLICT (workspace_key, qualified_model_id) DO UPDATE SET context_window = excluded.context_window",
        [workspaceKey, qualifiedModelId, value],
      );
    }
  }
}

/** No-op implementation for use in tests where model settings are not relevant. */
export class NullModelSettingsRepository implements ModelSettingsRepository {
  getContextWindow(_workspaceKey: string, _qualifiedModelId: string): number | null {
    return null;
  }
  setContextWindow(_workspaceKey: string, _qualifiedModelId: string, _value: number | null): void {
    // no-op
  }
}
