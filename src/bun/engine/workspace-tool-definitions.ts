/**
 * Workspace tool definitions — single source of truth for workspace discovery tools.
 *
 * Imported by common-tools.ts for engine-facing tool registration.
 *
 * Contains tools for discovering workspace projects and workflows (boards).
 */

import type { AIToolDefinition } from "../ai/types.ts";

// ─── Tool definitions (metadata + JSON schema) ────────────────────────────────

export const WORKSPACE_TOOL_DEFINITIONS: AIToolDefinition[] = [
  // ── list_projects ────────────────────────────────────────────────────────
  {
    name: "list_projects",
    description:
      "List all configured projects in the current workspace.\n\n" +
      "Usage:\n" +
      "- Returns full project data: key, name, project_path, git_root_path, default_branch\n" +
      "- Use this to discover available projects before calling file or git tools\n" +
      "- Projects are determined from the workspace context (chat session or task)",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ── list_workflows ───────────────────────────────────────────────────────
  {
    name: "list_workflows",
    description:
      "List all boards (runtime workflow instances) in the current workspace.\n\n" +
      "Usage:\n" +
      "- Returns board id, name, and workspace_key for each board\n" +
      "- Use this to discover available workflows before calling card tools\n" +
      "- Boards are determined from the workspace context (chat session or task)",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ─── Tool names set (for quick lookup) ──────────────────────────────────────

export const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOL_DEFINITIONS.map((t) => t.name));
