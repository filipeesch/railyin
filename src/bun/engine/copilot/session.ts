export interface CopilotSdkSessionConfig {
  sessionId?: string;
  model?: string;
  tools?: unknown[];
  systemMessage?: { mode: "append"; content: string };
  onPermissionRequest?: (request: unknown, invocation: unknown) => unknown;
  workingDirectory: string;
}

export type CopilotSdkResumeSessionConfig = Omit<CopilotSdkSessionConfig, "sessionId">;

export type CopilotSdkEvent =
  | { type: "assistant.message_delta"; data: { deltaContent: string } }
  | { type: "assistant.message"; data: { content?: string } }
  | { type: "assistant.reasoning_delta"; data: { deltaContent: string } }
  | { type: "assistant.reasoning"; data: { content?: string } }
  | { type: "session.ask_user"; data: { payload: string } }
  | { type: "tool.execution_start"; data: { toolCallId: string; toolName: string; arguments?: unknown } }
  | { type: "tool.execution_complete"; data: { toolCallId: string; success: boolean; result?: { content?: string } } }
  | { type: "assistant.usage"; data: { inputTokens?: number; outputTokens?: number } }
  | { type: "session.task_complete" }
  | { type: "session.idle" }
  | { type: "session.error"; data: { message: string } }
  | { type: string; data?: unknown };

export interface CopilotSdkModelInfo {
  id: string;
  name?: string;
  capabilities: {
    limits: { max_context_window_tokens: number };
    supports: { reasoningEffort?: boolean };
  };
}

export interface CopilotSdkSession {
  send(input: { prompt: string }): Promise<unknown>;
  on(listener: (event: CopilotSdkEvent) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CopilotSdkAdapter {
  createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession>;
  resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession>;
  abortSession(session: CopilotSdkSession): Promise<void>;
  disconnectSession(session: CopilotSdkSession): Promise<void>;
  listModels(): Promise<CopilotSdkModelInfo[]>;
}

type LoadedCopilotClient = {
  start(): Promise<void>;
  listModels(): Promise<unknown[]>;
  createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<LoadedCopilotSession>;
  resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<LoadedCopilotSession>;
};

type LoadedCopilotSession = {
  send(input: { prompt: string }): Promise<unknown>;
  on(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
};

// Singleton client — lazily initialised, shared across all executions.
let _clientPromise: Promise<LoadedCopilotClient> | undefined;

async function getClient(): Promise<LoadedCopilotClient> {
  if (!_clientPromise) {
    _clientPromise = import("@github/copilot-sdk").then(async (mod) => {
      console.log("[copilot] Starting client. COPILOT_CLI_PATH:", process.env.COPILOT_CLI_PATH ?? "(not set)", "PATH:", process.env.PATH);
      // The SDK reads COPILOT_CLI_PATH from the environment automatically.
      // In dev it auto-discovers @github/copilot from node_modules.
      // In production, users must set COPILOT_CLI_PATH to their global install.
      // Requires Node.js 22+ in PATH (the CLI uses node:sea and node:sqlite).
      const client = new mod.CopilotClient({}) as LoadedCopilotClient;
      await client.start();
      return client;
    });
  }
  return _clientPromise;
}

/**
 * Derive a deterministic Copilot SDK session ID from a Railyin task ID.
 *
 * Using a fixed, predictable ID means:
 * - No in-memory map needed.
 * - Context survives app restarts — resumeSession() always knows the right ID.
 * - A task always has exactly one persistent Copilot session.
 */
export function copilotSessionIdForTask(taskId: number): string {
  return `railyin-task-${taskId}`;
}

class DefaultCopilotSdkSession implements CopilotSdkSession {
  constructor(private readonly session: LoadedCopilotSession) { }

  send(input: { prompt: string }): Promise<unknown> {
    return this.session.send(input);
  }

  on(listener: (event: CopilotSdkEvent) => void): () => void {
    return this.session.on((event: unknown) => listener(event as CopilotSdkEvent));
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  disconnect(): Promise<void> {
    return this.session.disconnect();
  }
}

class DefaultCopilotSdkAdapter implements CopilotSdkAdapter {
  async createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession> {
    const client = await getClient();
    const session = await client.createSession(config);
    return new DefaultCopilotSdkSession(session);
  }

  async resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession> {
    const client = await getClient();
    const session = await client.resumeSession(sessionId, config);
    return new DefaultCopilotSdkSession(session);
  }

  abortSession(session: CopilotSdkSession): Promise<void> {
    return session.abort();
  }

  disconnectSession(session: CopilotSdkSession): Promise<void> {
    return session.disconnect();
  }

  async listModels(): Promise<CopilotSdkModelInfo[]> {
    const client = await getClient();
    await client.start();
    return (await client.listModels()) as CopilotSdkModelInfo[];
  }
}

export function createDefaultCopilotSdkAdapter(): CopilotSdkAdapter {
  return new DefaultCopilotSdkAdapter();
}
