import type { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "054_mcp_tools_visible_by_default";

/**
 * Reverses migration 044's "disabled by default" backfill now that MCP tools are exposed
 * via discovery tools (list_mcp_servers/list_mcp_tools/invoke_mcp_tool) rather than native
 * per-tool injection — the tool-list-bloat risk that motivated defaulting to "none visible"
 * no longer applies, since the model must explicitly call list_mcp_tools per server.
 *
 * Only rows still holding the literal '[]' backfilled by migration 044 are reset to NULL
 * (the new "not customized => all visible" default). Rows with a genuine non-empty
 * "server:tool" allow-list are left untouched — a user who deliberately narrowed their
 * selection keeps that selection.
 */
export function up(db: Database): void {
  if (hasTable(db, "tasks")) {
    db.run(`UPDATE tasks SET enabled_mcp_tools = NULL WHERE enabled_mcp_tools = '[]'`);
  }
  if (hasTable(db, "chat_sessions")) {
    db.run(`UPDATE chat_sessions SET enabled_mcp_tools = NULL WHERE enabled_mcp_tools = '[]'`);
  }
}
