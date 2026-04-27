import { api } from "../rpc";
import type { LaunchConfig } from "@shared/rpc-types";

export async function getLaunchConfig(taskId: number, _projectKey: string | null | undefined): Promise<LaunchConfig | null> {
  return api("launch.getConfig", { taskId }).catch(() => null);
}

export async function runLaunch(taskId: number, command: string, mode: "terminal" | "external-terminal" | "app" = "terminal"): Promise<{ ok: true; sessionId?: string } | { ok: false; error: string }> {
  return api("launch.run", { taskId, command, mode });
}
