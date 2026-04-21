import { LSPServerManager } from "./manager.ts";
import type { LspServerConfig } from "./manager.ts";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface RegistryEntry {
  manager: LSPServerManager | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  serverConfigs: LspServerConfig[];
  worktreePath: string;
}

class TaskLSPRegistry {
  private entries = new Map<number, RegistryEntry>();

  getManager(taskId: number, serverConfigs: LspServerConfig[], worktreePath: string): LSPServerManager | null {
    if (serverConfigs.length === 0) return null;
    let entry = this.entries.get(taskId);
    if (!entry) {
      entry = { manager: null, idleTimer: null, serverConfigs, worktreePath };
      this.entries.set(taskId, entry);
    }
    if (!entry.manager) {
      entry.manager = new LSPServerManager(entry.serverConfigs, entry.worktreePath);
    }
    // Reset idle timer
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const e = this.entries.get(taskId);
      if (e?.manager) {
        e.manager.shutdown().catch(() => {});
        e.manager = null;
      }
      if (e) e.idleTimer = null;
    }, IDLE_TIMEOUT_MS);
    return entry.manager;
  }

  async releaseTask(taskId: number): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry) return;
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.manager) {
      await entry.manager.shutdown().catch(() => {});
      entry.manager = null;
    }
    this.entries.delete(taskId);
  }
}

export const taskLspRegistry = new TaskLSPRegistry();
export { TaskLSPRegistry };
