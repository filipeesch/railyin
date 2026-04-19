import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../rpc";
import type { CodeRef } from "@shared/rpc-types";

export interface CodeServerInstance {
  port: number;
  status: "starting" | "ready" | "error";
  statusText: string;
}

export const useCodeServerStore = defineStore("codeServer", () => {
  const activeTaskId = ref<number | null>(null);
  const instances = ref<Map<number, CodeServerInstance>>(new Map());
  const pendingRefs = ref<Map<number, CodeRef[]>>(new Map());

  const activeInstance = computed<CodeServerInstance | null>(() => {
    if (activeTaskId.value === null) return null;
    return instances.value.get(activeTaskId.value) ?? null;
  });

  async function openEditor(taskId: number): Promise<void> {
    activeTaskId.value = taskId;

    const existing = instances.value.get(taskId);
    if (existing && existing.status === "ready") return;

    instances.value.set(taskId, { port: 0, status: "starting", statusText: "Starting code-server…" });

    try {
      const result = await api("codeServer.start", { taskId });
      if ("error" in result) {
        instances.value.set(taskId, { port: 0, status: "error", statusText: result.error });
        return;
      }
      instances.value.set(taskId, { port: result.port, status: "ready", statusText: "Ready" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      instances.value.set(taskId, { port: 0, status: "error", statusText: msg });
    }
  }

  function closeEditor(): void {
    activeTaskId.value = null;
  }

  async function stopEditor(taskId: number): Promise<void> {
    try {
      await api("codeServer.stop", { taskId });
    } catch {
      // ignore errors stopping
    }
    instances.value.delete(taskId);
    if (activeTaskId.value === taskId) {
      activeTaskId.value = null;
    }
  }

  function addRef(ref: CodeRef): void {
    const list = pendingRefs.value.get(ref.taskId) ?? [];
    list.push(ref);
    pendingRefs.value.set(ref.taskId, list);
  }

  function removeRef(taskId: number, index: number): void {
    const list = pendingRefs.value.get(taskId);
    if (!list) return;
    list.splice(index, 1);
    pendingRefs.value.set(taskId, [...list]);
  }

  function serializeRefs(taskId: number): string {
    const list = pendingRefs.value.get(taskId);
    if (!list || list.length === 0) return "";
    return list
      .map((r) => {
        const fence = "```";
        const header = `// ref: ${r.file} L${r.startLine}:${r.startChar}–L${r.endLine}:${r.endChar}`;
        return `${fence}${r.language}\n${header}\n${r.text}\n${fence}`;
      })
      .join("\n\n");
  }

  function clearRefs(taskId: number): void {
    pendingRefs.value.delete(taskId);
  }

  return {
    activeTaskId,
    instances,
    pendingRefs,
    activeInstance,
    openEditor,
    closeEditor,
    stopEditor,
    addRef,
    removeRef,
    serializeRefs,
    clearRefs,
  };
});
