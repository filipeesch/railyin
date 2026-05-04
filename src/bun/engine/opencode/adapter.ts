import type { OpenCodeEngineConfig, OpenCodeProviderConfig } from "../../config/index.ts";
import type { EngineEvent, EngineModelInfo, CommandInfo } from "../types.ts";
import type { OpenCodeRunParams, OpenCodeSdkAdapter } from "./types.ts";
import type { Config as OpenCodeConfig, Event as OpenCodeEvent } from "@opencode-ai/sdk/v2";
import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { McpContextEntry, OpenCodeMcpServer } from "./mcp-server.ts";
import { startOpenCodeMcpServer } from "./mcp-server.ts";
import { translatePart, translatePermissionAsked, translateSessionError, translateSessionStatus } from "./event-translator.ts";
import { mapAttachments } from "./attachment-mapper.ts";
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk/v2";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

interface ServerHandle {
  url: string;
  close(): void;
}

export class DefaultOpenCodeSdkAdapter implements OpenCodeSdkAdapter {
  private readonly engineConfig: OpenCodeEngineConfig;
  private serverHandle: ServerHandle | null = null;
  private client: OpencodeClient | null = null;
  private mcpServer: OpenCodeMcpServer | null = null;
  /** conversationId → OpenCode sessionID */
  private readonly sessionMap = new Map<number, string>();
  /** conversationId → execution context for MCP tool dispatch */
  private readonly contextMap: Map<number, McpContextEntry> = new Map();
  private startPromise: Promise<void> | null = null;

  constructor(engineConfig: OpenCodeEngineConfig) {
    this.engineConfig = engineConfig;
  }

  async getOrCreateSession(conversationId: number, workingDirectory: string): Promise<string> {
    await this.ensureStarted();
    const existing = this.sessionMap.get(conversationId);
    if (existing) return existing;

    const client = this.client!;
    const result = await client.session.create({ directory: workingDirectory });
    const sessionId = (result as { data?: { id?: string }; error?: unknown }).data?.id;
    if (!sessionId) throw new Error("Failed to create OpenCode session");

    this.sessionMap.set(conversationId, sessionId);
    return sessionId;
  }

  async *run(params: OpenCodeRunParams): AsyncIterable<EngineEvent> {
    await this.ensureStarted();
    const client = this.client!;

    const {
      executionId,
      conversationId,
      sessionId,
      prompt,
      systemInstructions,
      model,
      workingDirectory,
      attachments,
      signal,
      commonToolContext,
      onRawEvent,
    } = params;

    this.contextMap.set(conversationId, { commonToolContext });

    try {
      // Subscribe to events before prompting to avoid missing early events
      const { stream } = await client.event.subscribe({ directory: workingDirectory });

      // Parse model string "providerID/modelID" into separate fields
      const modelConfig = parseModel(model ?? this.engineConfig.model);

      // Build prompt parts
      const parts: Array<TextPartInput | FilePartInput> = [];
      let promptText = prompt;

      if (attachments?.length) {
        const { fileParts, extraText } = mapAttachments(attachments);
        if (extraText) promptText = `${extraText}\n\n${promptText}`;
        parts.push(...fileParts);
      }

      // Include conversationId in system instructions so the model always passes it to tools
      const fullSystem = buildSystemInstructions(conversationId, systemInstructions);
      parts.push({ type: "text", text: promptText });

      // Fire the prompt asynchronously — events arrive via the subscription
      const promptCall = client.session.promptAsync({
        sessionID: sessionId,
        directory: workingDirectory,
        parts,
        system: fullSystem,
        ...(modelConfig ?? {}),
      });

      // Handle abort signal
      const onAbort = () => {
        void client.session.abort({ sessionID: sessionId, directory: workingDirectory }).catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        await promptCall;

        // Process events filtered to our session
        for await (const rawEvent of stream) {
          const event = rawEvent as OpenCodeEvent;

          onRawEvent?.(sanitizeForLogging(event as Record<string, unknown>));

          const engineEvents = translateEvent(event, sessionId, executionId);
          for (const e of engineEvents) {
            yield e;
          }

          if (isSessionDone(event, sessionId)) break;
          if (signal.aborted) break;
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }

      if (!signal.aborted) {
        yield { type: "done" };
      }
    } finally {
      this.contextMap.delete(conversationId);
    }
  }

  async cancel(executionId: number): Promise<void> {
    // Cancellation is handled via the AbortSignal passed to run().
    // The signal triggers client.session.abort() when aborted.
    void executionId;
  }

  async compact(sessionId: string, workingDirectory: string): Promise<void> {
    await this.ensureStarted();
    const client = this.client!;
    await client.session.summarize({ sessionID: sessionId, directory: workingDirectory, auto: true });
  }

  async listModels(workingDirectory: string): Promise<EngineModelInfo[]> {
    await this.ensureStarted();
    const client = this.client!;
    const result = await client.provider.list({ directory: workingDirectory });
    const data = (result as { data?: { all?: unknown[] } }).data;
    if (!Array.isArray(data?.all)) return [];

    const models: EngineModelInfo[] = [];
    for (const provider of data.all as Array<{ id: string; name: string; models?: Record<string, { id: string; name: string; capabilities?: { reasoning?: boolean; contextWindow?: number } }> }>) {
      for (const [, model] of Object.entries(provider.models ?? {})) {
        models.push({
          qualifiedId: `${provider.id}/${model.id}`,
          displayName: model.name ?? model.id,
          contextWindow: model.capabilities?.contextWindow,
          supportsThinking: model.capabilities?.reasoning,
        });
      }
    }
    return models;
  }

  async listCommands(workingDirectory: string): Promise<CommandInfo[]> {
    await this.ensureStarted();
    const client = this.client!;
    const result = await client.app.skills({ directory: workingDirectory });
    const skills = (result as { data?: Array<{ name: string; description: string }> }).data;
    if (!Array.isArray(skills)) return [];
    return skills.map((s) => ({ name: s.name, description: s.description }));
  }

  async shutdown(): Promise<void> {
    this.sessionMap.clear();
    this.contextMap.clear();
    this.mcpServer?.close();
    this.mcpServer = null;
    this.serverHandle?.close();
    this.serverHandle = null;
    this.client = null;
    this.startPromise = null;
  }

  private async ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.startServer();
    }
    await this.startPromise;
  }

  private async startServer(): Promise<void> {
    const opencodeConfig = mapEngineConfig(this.engineConfig);
    this.serverHandle = await createOpencodeServer({ config: opencodeConfig });
    this.client = createOpencodeClient({ baseUrl: this.serverHandle.url });

    // Start Railyin's MCP server and register it with OpenCode
    this.mcpServer = startOpenCodeMcpServer(this.contextMap);
    await this.client.mcp.add({
      name: "railyin",
      config: { type: "remote", url: this.mcpServer.url },
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the system instructions string with conversationId injected at the top. */
function buildSystemInstructions(conversationId: number, extra?: string): string {
  const preamble = `SYSTEM: Your active conversationId is ${conversationId}. Always include conversationId: ${conversationId} as a parameter in every tool call.`;
  return extra ? `${preamble}\n\n${extra}` : preamble;
}

/** Parse "providerID/modelID" into OpenCode prompt model config, or null if not set. */
function parseModel(model?: string): { model?: { providerID: string; modelID: string } } | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash < 0) return null;
  return { model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) } };
}

/** Convert OpenCodeEngineConfig.providers to the OpenCode SDK Config format. */
function mapEngineConfig(config: OpenCodeEngineConfig): OpenCodeConfig {
  if (!config.providers) return {};

  const provider: Record<string, { options?: { apiKey?: string; baseURL?: string }; npm?: string; models?: Record<string, { name?: string }> }> = {};

  for (const [id, providerCfg] of Object.entries(config.providers)) {
    const options: Record<string, string> = {};
    if (providerCfg.api_key) options.apiKey = providerCfg.api_key;
    if (providerCfg.base_url) options.baseURL = providerCfg.base_url;

    provider[id] = {
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(providerCfg.npm ? { npm: providerCfg.npm } : {}),
      ...(providerCfg.models ? { models: providerCfg.models } : {}),
    };
  }

  return { provider };
}

/** Translate an OpenCode event to zero or more EngineEvents, filtering by sessionId. */
function translateEvent(event: OpenCodeEvent, sessionId: string, executionId: number): EngineEvent[] {
  if (event.type === "message.part.updated" && event.properties.sessionID === sessionId) {
    return translatePart(event.properties.part);
  }

  if (event.type === "permission.asked" && event.properties.sessionID === sessionId) {
    return [translatePermissionAsked(event, executionId)];
  }

  if (event.type === "session.error" && (event.properties.sessionID == null || event.properties.sessionID === sessionId)) {
    return [translateSessionError(event)];
  }

  if (event.type === "session.status" && event.properties.sessionID === sessionId) {
    const e = translateSessionStatus(event);
    return e ? [e] : [];
  }

  return [];
}

/** Return true if the event signals that the session is done processing. */
function isSessionDone(event: OpenCodeEvent, sessionId: string): boolean {
  return event.type === "session.idle" && event.properties.sessionID === sessionId;
}

/** Redact sensitive fields (apiKey) before passing to raw message logger. */
function sanitizeForLogging(obj: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...obj };
  if (typeof copy.apiKey === "string") copy.apiKey = "[REDACTED]";
  if (copy.properties && typeof copy.properties === "object") {
    copy.properties = sanitizeForLogging(copy.properties as Record<string, unknown>);
  }
  return copy;
}

export function createDefaultOpenCodeSdkAdapter(engineConfig: OpenCodeEngineConfig): DefaultOpenCodeSdkAdapter {
  return new DefaultOpenCodeSdkAdapter(engineConfig);
}
