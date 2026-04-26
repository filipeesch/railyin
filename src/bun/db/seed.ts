import { getDb } from "./index.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

export function seedDefaultWorkspace(): void {
  const db = getDb();

  // In test mode (in-memory DB) seed a minimal board so the app boots into
  // BoardView instead of the first-time setup wizard.
  // Tests then create their own task rows via /setup-test-env.
  if (process.env.RAILYN_DB === ":memory:") {
    const workspaceKey = getDefaultWorkspaceKey();
    const hasBoard = db.query<{ id: number }, []>("SELECT id FROM boards LIMIT 1").get();
    if (!hasBoard) {
      db.run(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES (?, 'Test Board', 'delivery', '[]')",
        [workspaceKey],
      );
      console.log("[db] Seeded test board");
    }
  }
}
