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
  private entries = new Map<string, RegistryEntry>();

  getManager(scopeId: string | number, serverConfigs: LspServerConfig[], worktreePath: string): LSPServerManager | null {
    if (serverConfigs.length === 0) return null;
    const registryKey = String(scopeId);
    let entry = this.entries.get(registryKey);
    if (!entry) {
      entry = { manager: null, idleTimer: null, serverConfigs, worktreePath };
      this.entries.set(registryKey, entry);
    }
    if (!entry.manager) {
      entry.manager = new LSPServerManager(entry.serverConfigs, entry.worktreePath);
    }
    // Reset idle timer
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const e = this.entries.get(registryKey);
      if (e?.manager) {
        e.manager.shutdown().catch(() => {});
        e.manager = null;
      }
      if (e) e.idleTimer = null;
    }, IDLE_TIMEOUT_MS);
    return entry.manager;
  }

  async releaseTask(scopeId: string | number): Promise<void> {
    const registryKey = String(scopeId);
    const entry = this.entries.get(registryKey);
    if (!entry) return;
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.manager) {
      await entry.manager.shutdown().catch(() => {});
      entry.manager = null;
    }
    this.entries.delete(registryKey);
  }
}

export const taskLspRegistry = new TaskLSPRegistry();
export { TaskLSPRegistry };
