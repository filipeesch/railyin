/**
 * Aggregates all Pi harness tool builders into a single factory.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import type { CommonToolContext, EngineEvent } from "../../types.ts";
import type { ChildSessionFactory } from "../child-session.ts";
import type { ProviderLimiterRegistry } from "../provider-limiter.ts";
import type { PiEngineConfig } from "../../../config/index.ts";
import type { Model } from "@earendil-works/pi-ai";
import { buildReadTools } from "./read.ts";
import { buildWriteTools } from "./write.ts";
import { buildUndoTool } from "./undo.ts";
import { buildShellTools } from "./shell.ts";
import { buildWebTools } from "./web.ts";
import { buildCommonTools, type SuspendRef } from "./common.ts";
import { buildSkillTool } from "./skill.ts";
import { buildDelegateTool } from "./delegate.ts";
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
  web: (harnessCtx: HarnessContext) => buildWebTools(harnessCtx),
} as const satisfies Record<string, (harnessCtx: HarnessContext) => AgentTool<any>[]>;

/** Default tool groups when a column has no explicit `tools:` config. */
export const DEFAULT_PI_TOOL_GROUPS: (keyof typeof PI_TOOL_GROUPS)[] = ["read", "write", "shell"];

export type PiToolGroupName = keyof typeof PI_TOOL_GROUPS;

export interface AllToolsOptions {
  harnessCtx: HarnessContext;
  commonCtx: CommonToolContext;
  skillResolver: SkillResolver;
  /** Tool group names from the workflow column's `tools:` config. When omitted, uses DEFAULT_PI_TOOL_GROUPS. */
  columnGroups?: string[];
  suspendRef?: SuspendRef;
  /** Mutable ref so the delegate tool can emit events to the parent stream. */
  delegateEmitRef?: { emit?: (event: EngineEvent) => void };
  /** Factory for child sessions (injectable; defaults to defaultChildSessionFactory). */
  childSessionFactory?: ChildSessionFactory;
  /** Provider limiter registry for rate-limiting child requests. */
  limiterRegistry?: ProviderLimiterRegistry;
  /** Parent model — passed to child sessions. */
  parentModel?: Model<"openai-completions">;
  /** Parent system prompt — passed to child sessions. */
  parentSystemPrompt?: string;
  /** Parent conversation ID. */
  parentConversationId?: number;
  /** Parent working directory — passed to child sessions. */
  parentCwd?: string;
  /** Parent engine config — used by the delegate tool for its own config. */
  engineConfig?: PiEngineConfig;
}

export type { SuspendRef };

/**
 * Build the tool set for a Pi agent session.
 * When `columnGroups` is provided, only tools belonging to those groups are included.
 * Board and interaction tools (common-tools) are always included.
 * The delegate tool is always included when its required options are provided and not disabled.
 */
export function buildAllTools(opts: AllToolsOptions): AgentTool<any>[] {
  const { harnessCtx, commonCtx, skillResolver, columnGroups, suspendRef } = opts;

  const activeGroups = (columnGroups ?? DEFAULT_PI_TOOL_GROUPS).filter(
    (g): g is PiToolGroupName => g in PI_TOOL_GROUPS,
  );

  const harnessTools = activeGroups.flatMap((group) => PI_TOOL_GROUPS[group](harnessCtx));

  // Build child tools without delegate options — design decision: delegate is NEVER in children's tool set.
  const childToolsBuilder = (groups: string[]): AgentTool<any>[] =>
    buildAllTools({ harnessCtx, commonCtx, skillResolver, columnGroups: groups });

  const delegateTools = buildDelegateTool(harnessCtx, { ...opts, buildChildTools: childToolsBuilder });

  return [...harnessTools, ...delegateTools, ...buildCommonTools(commonCtx, harnessCtx, suspendRef), buildSkillTool(skillResolver)];
}
