import type { TaskActivityEvent } from "./workspace-helpers";

export function getTaskActivityToast(
  activity: TaskActivityEvent | null,
  workspaceLabel: string,
): { severity: "info" | "warn" | "success"; summary: string; detail: string; life: number } | null {
  if (!activity) return null;

  const detail = `${workspaceLabel} - ${activity.task.title}`;
  if (activity.kind === "execution") {
    const map: Record<string, { severity: "info" | "warn" | "success"; summary: string }> = {
      running: { severity: "info", summary: "Task started" },
      waiting_user: { severity: "info", summary: "Task waiting" },
      waiting_external: { severity: "info", summary: "Task waiting" },
      completed: { severity: "success", summary: "Task completed" },
      failed: { severity: "warn", summary: "Task failed" },
      idle: { severity: "info", summary: "Task updated" },
      cancelled: { severity: "warn", summary: "Task cancelled" },
    };
    const toastPayload = map[activity.nextState] ?? { severity: "info", summary: "Task updated" };
    return { ...toastPayload, detail, life: 4000 };
  }

  return { severity: "info", summary: "Task moved", detail, life: 4000 };
}
