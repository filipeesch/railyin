/**
 * Aggregates all Pi harness tool builders into a single factory.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import type { CommonToolContext } from "../../types.ts";
import { buildReadTools } from "./read.ts";
import { buildWriteTools } from "./write.ts";
import { buildUndoTool } from "./undo.ts";
import { buildSearchTools } from "./search.ts";
import { buildShellTools } from "./shell.ts";
import { buildWebTools } from "./web.ts";
import { buildCommonTools } from "./common.ts";

export interface AllToolsOptions {
  harnessCtx: HarnessContext;
  commonCtx: CommonToolContext;
}

/** Build the full tool set for a Pi agent session. */
export function buildAllTools(opts: AllToolsOptions): AgentTool<any>[] {
  const { harnessCtx, commonCtx } = opts;
  return [
    ...buildReadTools(harnessCtx),
    ...buildWriteTools(harnessCtx),
    ...buildUndoTool(harnessCtx),
    ...buildSearchTools(harnessCtx),
    ...buildShellTools(harnessCtx),
    ...buildWebTools(harnessCtx),
    ...buildCommonTools(commonCtx),
  ];
}
