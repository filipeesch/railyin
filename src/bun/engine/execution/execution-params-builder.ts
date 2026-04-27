import type { ExecutionParams, RawModelMessage } from "../types.ts";
import type { TaskRow } from "../../db/row-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";

/**
 * Assembles ExecutionParams from a task row + pre-created signal.
 * Pure: no side effects — AbortController registration is done by StreamProcessor.createSignal().
 */
export class ExecutionParamsBuilder {
  build(
    task: TaskRow,
    conversationId: number,
    executionId: number,
    prompt: string,
    systemInstructions: string | undefined,
    workingDirectory: string,
    signal: AbortSignal,
    onRawModelMessage: (raw: RawModelMessage) => void,
    attachments?: Attachment[],
  ): ExecutionParams {
    const taskContext: ExecutionParams["taskContext"] = {
      title: task.title,
      ...(task.description?.trim() ? { description: task.description.trim() } : {}),
    };

    return {
      executionId,
      taskId: task.id,
      conversationId,
      boardId: task.board_id,
      prompt,
      systemInstructions,
      taskContext,
      workingDirectory,
      model: task.model ?? "",
      signal,
      onRawModelMessage,
      enabledMcpTools: task.enabled_mcp_tools
        ? (() => { try { return JSON.parse(task.enabled_mcp_tools!); } catch { return null; } })()
        : null,
      ...(attachments?.length ? { attachments } : {}),
    };
  }

  buildForChat(
    conversationId: number,
    executionId: number,
    prompt: string,
    workingDirectory: string,
    model: string,
    signal: AbortSignal,
    onRawModelMessage: (raw: RawModelMessage) => void,
    enabledMcpTools: string[] | null,
    attachments?: Attachment[],
  ): ExecutionParams {
    return {
      executionId,
      taskId: null,
      conversationId,
      prompt,
      systemInstructions: undefined,
      workingDirectory,
      model,
      signal,
      onRawModelMessage,
      enabledMcpTools,
      ...(attachments?.length ? { attachments } : {}),
    };
  }
}
