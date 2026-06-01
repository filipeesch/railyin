/**
 * Cursor SDK adapter for Railyin integration.
 *
 * This adapter handles Cursor SDK agent creation and event streaming.
 * The Cursor SDK uses gRPC/Connect protocol for agent execution.
 */

import type { EngineEvent } from "../types.ts";
import { Agent } from "@cursor/sdk";
import { translateCursorMessage } from "./events.ts";

export interface CursorSdkAdapter {
  run(config: CursorRunConfig): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  listModels(workingDirectory: string): Promise<CursorSdkModelInfo[]>;
  listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>>;
  shutdownAll?(): Promise<void>;
}

export interface CursorSdkModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportsThinking?: boolean;
}

export interface CursorRunConfig {
  executionId: number;
  taskId: number;
  prompt: string;
  workingDirectory: string;
  model?: string;
  systemInstructions?: string;
  taskContext?: { title: string; description?: string };
  signal?: AbortSignal;
  sessionId: string;
}

export function createDefaultCursorSdkAdapter(): CursorSdkAdapter {
  return new DefaultCursorSdkAdapter();
}

class DefaultCursorSdkAdapter implements CursorSdkAdapter {
  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    const { executionId, workingDirectory, model, prompt, signal } = config;

    const agentOptions: any = {
      model: model ? { id: model } : undefined,
      local: {
        cwd: workingDirectory,
      },
    };

    const session = await Agent.create(agentOptions);
    const run = await session.send(prompt);

    try {
      for await (const message of run.stream()) {
        const events = translateCursorMessage(message);
        for (const event of events) {
          yield event;
        }
      }
      yield { type: "done" };
    } finally {
      await run.cancel().catch(() => {});
      session.close();
    }
  }

  async cancel(executionId: number): Promise<void> {
    // Cancel handled via run.cancel() in the adapter
  }

  async listModels(workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    return [];
  }

  async listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    return [];
  }

  async shutdownAll(): Promise<void> {
    // No cleanup needed for in-process SDK
  }
}
