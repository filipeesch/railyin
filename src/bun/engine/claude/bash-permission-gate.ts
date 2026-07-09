import { ShellApprovalRepository, getUnapprovedShellBinaries, type ShellApprovalScope } from "../../db/repositories/shell-approval-repository.ts";
import type { EngineResumeInput } from "../types.ts";

export interface ShellApprovalWaitRequest {
  type: "shell_approval";
  command: string;
}

export type WaitForResumeShellFn = (request: ShellApprovalWaitRequest) => Promise<EngineResumeInput>;

export interface PreToolUseResult {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    updatedInput?: Record<string, unknown>;
    permissionDecisionReason?: string;
  };
}

/**
 * Encapsulates Bash shell approval logic for the Claude engine's PreToolUse hook.
 *
 * Handles all permission paths:
 *   - Non-Bash tools: auto-allow
 *   - Bash + shellAutoApprove: auto-allow
 *   - Bash + approved binary: auto-allow
 *   - Bash + unapproved binary: suspend and wait for user decision
 *   - approve_all: persist approved binaries to the repository
 */
export class BashPermissionGate {
  constructor(private readonly shellApprovalRepo: ShellApprovalRepository) {}

  async evaluate(
    toolName: string,
    input: Record<string, unknown>,
    scope: ShellApprovalScope,
    waitForResume: WaitForResumeShellFn,
  ): Promise<PreToolUseResult> {
    if (toolName !== "Bash") {
      return buildPreToolAllow(input);
    }

    const command = extractCommand(input);
    const shellState = this.shellApprovalRepo.getState(scope);

    if (shellState.shellAutoApprove) {
      return buildPreToolAllow(input);
    }

    const unapproved = getUnapprovedShellBinaries(command, shellState.approvedCommands);
    if (unapproved.length === 0) {
      return buildPreToolAllow(input);
    }

    const resumeInput = await waitForResume({ type: "shell_approval", command });

    if (resumeInput.type !== "shell_approval" || resumeInput.decision === "deny") {
      return buildPreToolDeny("Denied by user");
    }

    if (resumeInput.decision === "approve_all") {
      this.shellApprovalRepo.appendApprovedCommands(scope, unapproved);
    }

    return buildPreToolAllow(input);
  }
}

function extractCommand(input: Record<string, unknown>): string {
  return typeof input.command === "string" ? input.command : JSON.stringify(input);
}

export function buildPreToolAllow(input: Record<string, unknown>): PreToolUseResult {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: input,
    },
  };
}

export function buildPreToolDeny(reason: string): PreToolUseResult {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}
