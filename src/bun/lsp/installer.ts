import { spawn } from "child_process";

// ─── Allowed command allowlist ────────────────────────────────────────────────
// Only commands originating from the registry are accepted.
// This set is built from registry install commands at import time.
import { LANGUAGE_REGISTRY } from "./registry.ts";

const ALLOWED_COMMANDS: Set<string> = new Set(
  LANGUAGE_REGISTRY.flatMap((e) => e.installOptions.map((o) => o.command)),
);

/**
 * Validates that the command exactly matches one of the registry's install commands.
 * Rejects any command not in the allowlist, preventing injection of arbitrary shell commands.
 */
function isAllowedCommand(command: string): boolean {
  return ALLOWED_COMMANDS.has(command);
}

// ─── Install runner ───────────────────────────────────────────────────────────

/**
 * Runs a registry install command in a login shell so that PATH modifications
 * from shell profiles (e.g. ~/.cargo/env, ~/.nvm) are respected.
 *
 * Yields stdout/stderr lines as they arrive.
 * The final value (returned via `return`) is `{ success, output }`.
 */
export async function* runInstall(
  command: string,
  cwd: string,
): AsyncGenerator<string, { success: boolean; output: string }, unknown> {
  if (!isAllowedCommand(command)) {
    yield `Error: command not in install allowlist: ${command}`;
    return { success: false, output: `Command not allowed: ${command}` };
  }

  const [shell, shellArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", command]]
      : ["sh", ["-l", "-c", command]];

  const lines: string[] = [];

  const child = spawn(shell, shellArgs, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Buffer partial chunks and emit complete lines
  function makeLineEmitter(onLine: (line: string) => void) {
    let buf = "";
    return (chunk: Buffer | string) => {
      buf += chunk.toString();
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const part of parts) onLine(part);
    };
  }

  // Because this is an async generator we use a queue + promise pattern
  const queue: string[] = [];
  let resolve: (() => void) | null = null;
  let finished = false;
  let exitCode: number | null = null;

  function enqueue(line: string) {
    queue.push(line);
    if (resolve) { resolve(); resolve = null; }
  }

  const onStdout = makeLineEmitter((line) => { enqueue(line); lines.push(line); });
  const onStderr = makeLineEmitter((line) => { enqueue(line); lines.push(line); });

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);

  child.on("close", (code) => {
    exitCode = code ?? 1;
    finished = true;
    if (resolve) { resolve(); resolve = null; }
  });

  while (!finished || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      await new Promise<void>((res) => { resolve = res; });
    }
  }
  // Flush remaining queue after close
  while (queue.length > 0) yield queue.shift()!;

  const success = exitCode === 0;
  const output = lines.join("\n");
  return { success, output };
}
