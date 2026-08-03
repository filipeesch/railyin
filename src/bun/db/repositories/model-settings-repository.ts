import type { Db } from "../db.ts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ModelSettingsRepository {
  /** Returns the stored context window override for the given model, or null if none. */
  getContextWindow(workspaceKey: string, qualifiedModelId: string): Promise<number | null>;
  /** Stores a context window override. Pass null to remove the override. */
  setContextWindow(workspaceKey: string, qualifiedModelId: string, value: number | null): Promise<void>;
}

// ─── SQLite implementation ────────────────────────────────────────────────────

export class SqliteModelSettingsRepository implements ModelSettingsRepository {
  constructor(private readonly db: Db) {}

  async getContextWindow(workspaceKey: string, qualifiedModelId: string): Promise<number | null> {
    const row = await this.db.get<{ context_window: number | null }>(
      "SELECT context_window FROM model_settings WHERE workspace_key = $1 AND qualified_model_id = $2",
      [workspaceKey, qualifiedModelId],
    );
    return row?.context_window ?? null;
  }

  async setContextWindow(workspaceKey: string, qualifiedModelId: string, value: number | null): Promise<void> {
    if (value === null) {
      await this.db.exec(
        "DELETE FROM model_settings WHERE workspace_key = $1 AND qualified_model_id = $2",
        [workspaceKey, qualifiedModelId],
      );
    } else {
      await this.db.exec(
        "INSERT INTO model_settings (workspace_key, qualified_model_id, context_window) VALUES ($1, $2, $3) ON CONFLICT (workspace_key, qualified_model_id) DO UPDATE SET context_window = excluded.context_window",
        [workspaceKey, qualifiedModelId, value],
      );
    }
  }
}

/** No-op implementation for use in tests where model settings are not relevant. */
export class NullModelSettingsRepository implements ModelSettingsRepository {
  async getContextWindow(_workspaceKey: string, _qualifiedModelId: string): Promise<number | null> {
    return null;
  }
  async setContextWindow(_workspaceKey: string, _qualifiedModelId: string, _value: number | null): Promise<void> {
    // no-op
  }
}
