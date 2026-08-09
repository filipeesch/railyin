import type { IBroadcastChannel } from "./broadcast-channel.ts";
import type { Task, ChatSession } from "../../shared/rpc-types.ts";

export class NotificationService {
  constructor(private readonly channel: IBroadcastChannel) {}

  /**
   * A2 decision (07-01 Task 3): DROP — the custom error push is dead.
   * Chat failures surface via the AG-UI RUN_ERROR event; task failures via the
   * board execution_state='failed' badge. The push type dies with the protocol
   * trim (07-03); this is a no-op so no half-alive protocol surface remains.
   */
  onError(
    _taskId: number | null,
    _conversationId: number,
    _executionId: number,
    _error: string
  ): void {
    // no-op (A2): see comment above.
  }

  notifyTaskUpdated(task: Task): void {
    this.channel.broadcast({ type: "task.updated", payload: task });
  }

  notifyWorkflowReloaded(): void {
    this.channel.broadcast({ type: "workflow.reloaded", payload: {} });
  }

  notifyChatSessionUpdated(session: ChatSession): void {
    this.channel.broadcast({ type: "chatSession.updated", payload: session });
  }
}
