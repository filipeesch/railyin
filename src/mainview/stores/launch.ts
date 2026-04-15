import { defineStore } from "pinia";
import { electroview } from "../rpc";
import type { LaunchConfig } from "@shared/rpc-types";

export const useLaunchStore = defineStore("launch", () => {
  async function getConfig(taskId: number, _projectKey: string | null | undefined): Promise<LaunchConfig | null> {
    return electroview.rpc!.request["launch.getConfig"]({ taskId }).catch(() => null);
  }

  async function run(taskId: number, command: string, mode: "terminal" | "app" = "terminal"): Promise<{ ok: true } | { ok: false; error: string }> {
    return electroview.rpc!.request["launch.run"]({ taskId, command, mode });
  }

  return { getConfig, run };
});
