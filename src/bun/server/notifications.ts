import type { IBroadcastChannel } from "./broadcast-channel.ts";
import type { Task, ConversationMessage, ChatSession } from "../../shared/rpc-types.ts";

export class NotificationService {
  constructor(private readonly channel: IBroadcastChannel) {}

  onError(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    error: string
  ): void {
    this.channel.broadcast({ type: "stream.error", payload: { taskId, conversationId, executionId, error } });
  }

  notifyTaskUpdated(task: Task): void {
    this.channel.broadcast({ type: "task.updated", payload: task });
  }

  notifyNewMessage(message: ConversationMessage): void {
    this.channel.broadcast({ type: "message.new", payload: message });
  }

  notifyWorkflowReloaded(): void {
    this.channel.broadcast({ type: "workflow.reloaded", payload: {} });
  }

  notifyChatSessionUpdated(session: ChatSession): void {
    this.channel.broadcast({ type: "chatSession.updated", payload: session });
  }

  broadcastConfigError(details: object): void {
    this.channel.broadcast({ type: "config.error", payload: details });
  }
}
