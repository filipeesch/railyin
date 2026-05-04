import type { Database } from "bun:sqlite";

export const id = "038_seed_copilot_auto_model";

export function up(db: Database): void {
  // Seed the Copilot auto model in enabled_models for backward compatibility
  // This ensures existing users continue to see the auto model after the architecture change
  // that treats auto as an ordinary model that needs to be enabled.
  
  // Get all distinct workspace keys that don't already have copilot/auto enabled
  const workspacesWithoutAuto = db.query<
    { workspace_key: string },
    []
  >(
    `SELECT DISTINCT b.workspace_key
     FROM boards b
     LEFT JOIN enabled_models em ON b.workspace_key = em.workspace_key 
       AND em.qualified_model_id = 'copilot/auto'
     WHERE em.qualified_model_id IS NULL`
  ).all();
  
  // Enable copilot/auto for each workspace
  for (const { workspace_key } of workspacesWithoutAuto) {
    db.run(
      "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES (?, ?)",
      [workspace_key, "copilot/auto"]
    );
  }
}