/**
 * Mock Cursor SDK adapter for testing.
 *
 * Simulates Cursor SDK behavior (Agent.create, Agent.send, Run.stream)
 * using an AsyncGenerator to yield messages and events.
 */

import type { EngineEvent } from "@bun/engine/types";
import type { CursorSdkAdapter, CursorSdkModelInfo } from "@bun/engine/cursor/adapter";

export interface MockCursorMessage {
  type: "assistant" | "thinking" | "tool_call" | "status";
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface MockCursorRunConfig {
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

export class MockCursorSdkAdapter implements CursorSdkAdapter {
  private readonly messages: MockCursorMessage[];
  private readonly abortController = new AbortController();

  constructor(messages: MockCursorMessage[] = []) {
    this.messages = messages;
  }

  async *run(config: MockCursorRunConfig): AsyncIterable<EngineEvent> {
    // Simulate the streaming behavior
    for (const msg of this.messages) {
      yield* this.translateMessage(msg);
    }
    yield { type: "done" };
  }

  async cancel(executionId: number): Promise<void> {
    this.abortController.abort();
  }

  async listModels(workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    // Return mock model info
    return [
      {
        value: "cursor/default",
        displayName: "Cursor Default",
        description: "Default Cursor model",
        supportsThinking: true,
      },
    ];
  }

  async listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    // Cursor doesn't have slash commands
    return [];
  }

  async shutdownAll(): Promise<void> {
    // No cleanup needed
  }

  private *translateMessage(message: MockCursorMessage): Iterable<EngineEvent> {
    switch (message.type) {
      case "assistant": {
        if (message.content) {
          yield { type: "token", content: message.content };
        }
        break;
      }

      case "thinking": {
        if (message.content) {
          yield { type: "reasoning", content: message.content };
        }
        break;
      }

      case "tool_call": {
        // For now, just yield a status event
        yield {
          type: "status",
          message: "Tool call executed",
        };
        break;
      }

      case "status": {
        if (message.content) {
          yield {
            type: "status",
            message: message.content,
          };
        }
        break;
      }
    }
  }
}

export function createMockCursorSdkAdapter(messages: MockCursorMessage[] = []): MockCursorSdkAdapter {
  return new MockCursorSdkAdapter(messages);
}
