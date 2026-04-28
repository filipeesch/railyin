import type { Task } from "../../../shared/rpc-types.ts";

export interface BoardToolContext {
  taskId?: number;
  boardId?: number;
  onTransition: (taskId: number, toState: string) => void;
  onHumanTurn: (taskId: number, message: string) => void;
  onCancel: (executionId: number) => void;
  onTaskUpdated: (task: Task) => void;
}
