import { defineStore } from "pinia";
import { api } from "../rpc";
import type { LaunchConfig } from "@shared/rpc-types";

export const useLaunchStore = defineStore("launch", () => {
  async function getConfig(taskId: number, _projectKey: string | null | undefined): Promise<LaunchConfig | null> {
    return api("launch.getConfig", { taskId }).catch(() => null);
  }

  async function run(taskId: number, command: string, mode: "terminal" | "external-terminal" | "app" = "terminal"): Promise<{ ok: true; sessionId?: string } | { ok: false; error: string }> {
    return api("launch.run", { taskId, command, mode });
  }

  return { getConfig, run };
});
