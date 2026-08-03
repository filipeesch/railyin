import { getDb } from "./index.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

export async function seedDefaultWorkspace(): Promise<void> {
  const db = getDb();

  // In test mode (in-memory DB) seed a minimal board so the app boots into
  // BoardView instead of the first-time setup wizard.
  // Tests then create their own task rows via /setup-test-env.
  if (process.env.RAILYN_DB === ":memory:") {
    const workspaceKey = getDefaultWorkspaceKey();
    const hasBoard = await db.get<{ id: number }>("SELECT id FROM boards LIMIT 1");
    if (!hasBoard) {
      await db.exec(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES ($1, 'Test Board', 'delivery', '[]')",
        [workspaceKey],
      );
      console.log("[db] Seeded test board");
    }
  }
}
