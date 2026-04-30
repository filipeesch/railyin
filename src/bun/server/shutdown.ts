import type { Orchestrator } from "../engine/orchestrator.ts";
import { killAllPtySessions as defaultKillAllPtySessions } from "../launch/pty.ts";
import { stopAllCodeServers as defaultStopAllCodeServers } from "../launch/code-server.ts";

interface ShutdownOpts {
  graceMs?: number;
  killAllPtySessions?: () => void;
  stopAllCodeServers?: () => void;
  exitFn?: (code: number) => never;
}

export function createShutdownHandler(
  orchestrator: Orchestrator | null,
  opts?: ShutdownOpts,
): { shutdown(): Promise<void> } {
  const graceMs = opts?.graceMs ?? Number(process.env.RAILYN_SHUTDOWN_GRACE_MS ?? 3_000);
  const killAllPtySessions = opts?.killAllPtySessions ?? defaultKillAllPtySessions;
  const stopAllCodeServers = opts?.stopAllCodeServers ?? defaultStopAllCodeServers;
  const exitFn: (code: number) => never =
    opts?.exitFn ?? ((code) => process.exit(code) as never);

  let started = false;

  async function shutdown(): Promise<void> {
    if (started) return;
    started = true;

    try {
      await orchestrator?.shutdownNonNativeEngines?.({ reason: "app-exit", deadlineMs: graceMs });
    } catch (err) {
      console.warn("[shutdown] Graceful engine shutdown failed", err instanceof Error ? err.message : String(err));
    }
    killAllPtySessions();
    stopAllCodeServers();
    exitFn(0);
  }

  return { shutdown };
}
