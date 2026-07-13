import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { runCommand, type CommandRunner } from "./shell-runner.ts";
import { truncateHeadTail } from "./truncate-output.ts";

// Proportional to the previous flat 8KB/2KB stdout/stderr limits: each stream
// keeps a 25% head / 75% tail split of its own budget so both the start and
// the end of long output (e.g. a test run's initial setup and its final
// pass/fail summary) survive truncation.
const STDOUT_LIMIT = 8 * 1024;
const STDOUT_HEAD = STDOUT_LIMIT / 4;
const STDOUT_TAIL = STDOUT_LIMIT - STDOUT_HEAD;

const STDERR_LIMIT = 2 * 1024;
const STDERR_HEAD = STDERR_LIMIT / 4;
const STDERR_TAIL = STDERR_LIMIT - STDERR_HEAD;

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_TIMEOUT_MS = 3_600_000; // 60 minutes ceiling

const runCommandParams = Type.Object({
  command: Type.String({
    description: "Shell command to run (executed via sh -c in the worktree directory).",
  }),
  timeout_ms: Type.Optional(Type.Integer({
    default: DEFAULT_TIMEOUT_MS,
    description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} (10 minutes); values above ${MAX_TIMEOUT_MS} (60 minutes) are silently capped at the ceiling.`,
  })),
});

function buildShellTool(
  harnessCtx: HarnessContext,
  runner: CommandRunner = runCommand,
): AgentTool<typeof runCommandParams> {
  return {
    name: "run_command",
    label: "Run Command",
    description: `Run a shell command in the worktree for read-only inspection (git, grep, ls, cat, etc.).

NEVER use run_command to write or edit files — ALWAYS use write_file or patch_file instead.
NEVER use run_command to create files, append to files, or redirect output to files.
ALWAYS prefer read_file, grep, and find over shell commands for file operations.
Use run_command for: git commands, running tests, checking tool versions, network inspection.
Commands can run up to ${MAX_TIMEOUT_MS / 60_000} minutes via timeout_ms. Output is truncated to keep both the
start and end of long output; if a command's full output is important, redirect it to a file yourself
and inspect the file afterward with read_file or grep instead of relying on truncated inline output.`,
    parameters: runCommandParams,
    execute: async (_id, args) => {
      const effectiveTimeoutMs = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

      const result = await runner(args.command, {
        cwd: harnessCtx.worktreePath,
        timeoutMs: effectiveTimeoutMs,
        signal: harnessCtx.signal,
      });

      const { text: stdout } = truncateHeadTail(result.stdout, STDOUT_HEAD, STDOUT_TAIL);
      const { text: stderr } = truncateHeadTail(result.stderr, STDERR_HEAD, STDERR_TAIL);

      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`STDERR:\n${stderr}`);
      if (result.timedOut) parts.push(`Command timed out after ${effectiveTimeoutMs}ms and was terminated.`);
      if (result.aborted) parts.push("Command was cancelled and terminated.");
      if (!result.timedOut && !result.aborted && result.exitCode !== 0) {
        parts.push(`Exit code: ${result.exitCode ?? "null"}`);
      }

      const text = parts.join("\n").trim() || "(no output)";

      return {
        content: [{ type: "text", text }],
        details: { command: args.command, exitCode: result.exitCode },
      };
    },
  };
}

export function buildShellTools(harnessCtx: HarnessContext, runner: CommandRunner = runCommand): AgentTool<any>[] {
  return [buildShellTool(harnessCtx, runner)];
}
