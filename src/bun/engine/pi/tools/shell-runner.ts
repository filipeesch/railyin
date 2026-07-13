/**
 * Async, cancellable, process-group-aware command runner used by run_command.
 *
 * Replaces the previous `spawnSync`-based implementation, which blocked Bun's
 * entire single-threaded event loop for the full duration of the child
 * process. This runner uses `Bun.spawn` (async), spawns the child as its own
 * process-group leader (`detached: true`), and terminates the whole group
 * (not just the direct child) via SIGTERM -> grace period -> SIGKILL on
 * timeout or external cancellation (AbortSignal).
 */

export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True if the command was terminated because `timeoutMs` elapsed. */
  timedOut: boolean;
  /** True if the command was terminated because `signal` was aborted. */
  aborted: boolean;
}

export interface CommandRunOptions {
  cwd: string;
  /** Effective (already clamped) timeout in milliseconds. */
  timeoutMs: number;
  /** Aborting this signal terminates the command the same way a timeout does. */
  signal?: AbortSignal;
  /** Grace period between SIGTERM and SIGKILL, in milliseconds. Configurable for tests. */
  gracePeriodMs?: number;
}

/** A process runner is any function with this shape — the DI seam for tests. */
export type CommandRunner = (command: string, options: CommandRunOptions) => Promise<CommandRunResult>;

const DEFAULT_GRACE_PERIOD_MS = 3_000;

/**
 * Terminates the process group led by `pid`: SIGTERM, wait `gracePeriodMs`,
 * then SIGKILL if the process is still alive. Uses a negative PID, which on
 * POSIX targets the whole process group rather than just the direct child.
 * Errors from `process.kill` (e.g. ESRCH — already exited) are swallowed.
 */
async function killProcessGroup(pid: number, gracePeriodMs: number): Promise<void> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return; // group already gone
  }

  await new Promise((resolve) => setTimeout(resolve, gracePeriodMs));

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already exited during the grace period — nothing to do
  }
}

/** Default runner: spawns a real `sh -c <command>` process via Bun.spawn. */
export const runCommand: CommandRunner = async (command, options) => {
  const { cwd, timeoutMs, signal, gracePeriodMs = DEFAULT_GRACE_PERIOD_MS } = options;

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  let timedOut = false;
  let aborted = false;
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    void killProcessGroup(proc.pid, gracePeriodMs);
  }, timeoutMs);

  const onAbort = () => {
    if (settled) return;
    aborted = true;
    void killProcessGroup(proc.pid, gracePeriodMs);
  };
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) onAbort();

  try {
    const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      stdout: stdoutBuf,
      stderr: stderrBuf,
      exitCode,
      timedOut,
      aborted,
    };
  } finally {
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};
