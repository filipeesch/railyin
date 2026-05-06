import type { ExecutionParams, RawModelMessage } from "../types.ts";
import type { TaskRow } from "../../db/row-types.ts";
import type { Attachment } from "../../../shared/rpc-types.ts";

/**
 * Assembles ExecutionParams from a task row + pre-created signal.
 * Pure: no side effects — AbortController registration is done by StreamProcessor.createSignal().
 */
export class ExecutionParamsBuilder {

  constructor() {}

  private _buildBase(
    conversationId: number,
    executionId: number,
    prompt: string,
    systemInstructions: string | undefined,
    workingDirectory: string,
    signal: AbortSignal,
    onRawModelMessage: (raw: RawModelMessage) => void,
    attachments?: Attachment[],
  ) {
    return {
      executionId,
      conversationId,
      prompt,
      systemInstructions,
      workingDirectory,
      signal,
      onRawModelMessage,
      ...(attachments?.length ? { attachments } : {}),
    };
  }

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
    model?: string,
  ): ExecutionParams {
    const taskContext: ExecutionParams["taskContext"] = {
      title: task.title,
      ...(task.description?.trim() ? { description: task.description.trim() } : {}),
    };

    const base = this._buildBase(conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, onRawModelMessage, attachments);

    return {
      ...base,
      taskId: task.id,
      boardId: task.board_id,
      taskContext,
      workingDirectory,
      model: model ?? task.conversation_model ?? "",
      signal,
      onRawModelMessage,
      enabledMcpTools: task.enabled_mcp_tools
        ? (() => { try { return JSON.parse(task.enabled_mcp_tools!); } catch { return null; } })()
        : null,
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
    const base = this._buildBase(conversationId, executionId, prompt, undefined, workingDirectory, signal, onRawModelMessage, attachments);

    return {
      ...base,
      taskId: null,
      model,
      enabledMcpTools,
    };
  }
}
