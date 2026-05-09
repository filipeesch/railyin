/**
 * Aggregates all Pi harness tool builders into a single factory.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import type { CommonToolContext } from "../../types.ts";
import { buildReadTools } from "./read.ts";
import { buildWriteTools } from "./write.ts";
import { buildUndoTool } from "./undo.ts";
import { buildSearchTools } from "./search.ts";
import { buildShellTools } from "./shell.ts";
import { buildWebTools } from "./web.ts";
import { buildCommonTools, type SuspendRef } from "./common.ts";

/**
 * Maps workflow column tool group names (from `tools:` in workflow YAML) to
 * the builder functions that produce the corresponding Pi AgentTool instances.
 * Board/interaction tools from common-tools are always injected regardless of column config.
 */
export const PI_TOOL_GROUPS = {
  read: (harnessCtx: HarnessContext) => buildReadTools(harnessCtx),
  write: (harnessCtx: HarnessContext) => [...buildWriteTools(harnessCtx), ...buildUndoTool(harnessCtx)],
  search: (harnessCtx: HarnessContext) => buildSearchTools(harnessCtx),
  shell: (harnessCtx: HarnessContext) => buildShellTools(harnessCtx),
  web: (harnessCtx: HarnessContext) => buildWebTools(harnessCtx),
} as const satisfies Record<string, (harnessCtx: HarnessContext) => AgentTool<any>[]>;

/** Default tool groups when a column has no explicit `tools:` config. */
export const DEFAULT_PI_TOOL_GROUPS: (keyof typeof PI_TOOL_GROUPS)[] = ["read", "write", "search", "shell"];

export type PiToolGroupName = keyof typeof PI_TOOL_GROUPS;

export interface AllToolsOptions {
  harnessCtx: HarnessContext;
  commonCtx: CommonToolContext;
  /** Tool group names from the workflow column's `tools:` config. When omitted, uses DEFAULT_PI_TOOL_GROUPS. */
  columnGroups?: string[];
  suspendRef?: SuspendRef;
}

export type { SuspendRef };

/**
 * Build the tool set for a Pi agent session.
 * When `columnGroups` is provided, only tools belonging to those groups are included.
 * Board and interaction tools (common-tools) are always included.
 */
export function buildAllTools(opts: AllToolsOptions): AgentTool<any>[] {
  const { harnessCtx, commonCtx, columnGroups, suspendRef } = opts;

  const activeGroups = (columnGroups ?? DEFAULT_PI_TOOL_GROUPS).filter(
    (g): g is PiToolGroupName => g in PI_TOOL_GROUPS,
  );

  const harnesTools = activeGroups.flatMap((group) => PI_TOOL_GROUPS[group](harnessCtx));

  return [...harnesTools, ...buildCommonTools(commonCtx, suspendRef)];
}
