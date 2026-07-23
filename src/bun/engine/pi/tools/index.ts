/**
 * Aggregates all Pi harness tool builders into a single factory.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import type { CommonToolContext, EngineEvent, RawModelMessage } from "../../types.ts";
import type { Model } from "@earendil-works/pi-ai";
import type { PiEngineConfig } from "../../../config/index.ts";
import type { ChildSessionFactory } from "../child-session.ts";
import type { ProviderLimiterRegistry } from "../provider-limiter.ts";
import type { BrowserSessionFactory } from "./browser.ts";
import { buildReadTools } from "./read.ts";
import { buildWriteTools } from "./write.ts";
import { buildUndoTool } from "./undo.ts";
import { buildShellTools } from "./shell.ts";
import { buildWebTools, type WebSearchToolOptions } from "./web.ts";
import { buildCommonTools, type SuspendRef } from "./common.ts";
import { buildSkillTool } from "./skill.ts";
import type { SkillResolver } from "../skill-resolver.ts";

/**
 * Maps workflow column tool group names (from `tools:` in workflow YAML) to
 * the builder functions that produce the corresponding Pi AgentTool instances.
 * Board/interaction tools from common-tools are always injected regardless of column config.
 */
export const PI_TOOL_GROUPS = {
  read: () => buildReadTools(),
  write: (harnessCtx: HarnessContext) => [...buildWriteTools(harnessCtx), ...buildUndoTool(harnessCtx)],
  shell: (harnessCtx: HarnessContext) => buildShellTools(harnessCtx),
  web: (harnessCtx: HarnessContext, webSearchOpts?: WebSearchToolOptions) => buildWebTools(harnessCtx, webSearchOpts ?? {}),
} as const;

/** Default tool groups when a column has no explicit `tools:` config. */
export const DEFAULT_PI_TOOL_GROUPS: (keyof typeof PI_TOOL_GROUPS)[] = ["read", "write", "shell"];

export type PiToolGroupName = keyof typeof PI_TOOL_GROUPS;

/** Child-spawning dependencies shared by delegate and web_search tools. */
export interface ChildSpawnOptions {
  delegateEmitRef?: { emit?: (event: EngineEvent) => void };
  childSessionFactory?: ChildSessionFactory;
  limiterRegistry?: ProviderLimiterRegistry;
  parentModel?: Model<"openai-completions">;
  parentSystemPrompt?: string;
  parentCwd?: string;
  parentConversationId?: number;
  engineConfig?: PiEngineConfig;
  onRawModelMessage?: (message: RawModelMessage) => void;
  browserFactory?: BrowserSessionFactory;
}

export interface AllToolsOptions {
  harnessCtx: HarnessContext;
  commonCtx: CommonToolContext;
  skillResolver: SkillResolver;
  /** Tool group names from the workflow column's `tools:` config. When omitted, uses DEFAULT_PI_TOOL_GROUPS. */
  columnGroups?: string[];
  suspendRef?: SuspendRef;
  /** Child-spawning dependencies for delegate and web_search tools. */
  childSpawn?: ChildSpawnOptions;
}

export type { SuspendRef };

/**
 * Build the tool set for a Pi agent session.
 * When `columnGroups` is provided, only tools belonging to those groups are included.
 * Board and interaction tools (common-tools) are always included.
 */
export function buildAllTools(opts: AllToolsOptions): AgentTool<any>[] {
  const { harnessCtx, commonCtx, skillResolver, columnGroups, suspendRef, childSpawn } = opts;

  const activeGroups = (columnGroups ?? DEFAULT_PI_TOOL_GROUPS).filter(
    (g): g is PiToolGroupName => g in PI_TOOL_GROUPS,
  );

  const harnessTools = activeGroups.flatMap((group) => {
    const builder = PI_TOOL_GROUPS[group];
    // The web group needs the web search options
    if (group === "web") {
      return (builder as (harnessCtx: HarnessContext, webSearchOpts: WebSearchToolOptions) => AgentTool<any>[])(
        harnessCtx,
        childSpawn ?? {},
      );
    }
    return (builder as (harnessCtx: HarnessContext) => AgentTool<any>[])(harnessCtx);
  });

  return [...harnessTools, ...buildCommonTools(commonCtx, harnessCtx, suspendRef), buildSkillTool(skillResolver)];
}
