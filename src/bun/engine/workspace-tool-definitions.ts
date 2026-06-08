/**
 * Workspace-level tool definitions.
 *
 * Imported by common-tools.ts (engine-facing tool registration).
 */

import type { AIToolDefinition } from "../ai/types.ts";

// ─── Tool definitions (metadata + JSON schema) ────────────────────────────────

export const WORKSPACE_TOOL_DEFINITIONS: AIToolDefinition[] = [
  {
    name: "list_projects",
    description:
      "List all projects in the current workspace.\n\n" +
      "Usage:\n" +
      "- Returns project key, name, path, git repository, default branch, slug, and description\n" +
      "- Use to discover valid project keys before filtering tasks or creating new tasks\n" +
      "- Returns empty list if no projects are configured",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOL_DEFINITIONS.map((t) => t.name));

// ─── Display builder for workspace tools ──────────────────────────────────────

import type { ToolCallDisplay } from "../../shared/rpc-types.ts";

export function buildWorkspaceToolDisplay(name: string, _args: Record<string, unknown>): ToolCallDisplay | null {
  switch (name) {
    case "list_projects":
      return { label: "list projects" };
    default:
      return null;
  }
}
