/**
 * PiSessionManager — owns the Map<conversationId, AgentSession> lifecycle.
 *
 * Handles session creation via an injectable SessionFactory, session reuse
 * (updating model/systemPrompt/tools on the existing session), and disposal.
 * The PI_SESSIONS_DIR is computed from a SessionPathResolver so tests can
 * inject an in-memory path without writing to ~/.railyin/.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SessionFactory } from "./engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import type { Model } from "@earendil-works/pi-ai";
import { buildToolAllowlist } from "./constants.ts";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createHash } from "crypto";

const DEFAULT_PI_SESSIONS_DIR = join(homedir(), ".railyin", "pi-sessions");

/** Injectable path resolver — maps conversationId to a session file path. */
export interface SessionPathResolver {
  pathForConversation(conversationId: number): string;
}

/** Default implementation: ~/.railyin/pi-sessions/{sha1}.jsonl */
export class DefaultSessionPathResolver implements SessionPathResolver {
  constructor(private readonly sessionsDir: string = DEFAULT_PI_SESSIONS_DIR) {}

  pathForConversation(conversationId: number): string {
    const hash = createHash("sha1")
      .update(`railyin-pi-conversation-${conversationId}`)
      .digest("hex");
    return join(this.sessionsDir, `${hash}.jsonl`);
  }
}

export class PiSessionManager {
  /** Map<conversationId, AgentSession> — one Pi session per conversation. */
  readonly sessions = new Map<number, AgentSession>();

  constructor(
    private readonly sessionFactory: SessionFactory,
    private readonly config: PiEngineConfig,
    private readonly pathResolver: SessionPathResolver = new DefaultSessionPathResolver(),
  ) {}

  async getOrCreate(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: AgentTool<any>[],
    systemPrompt: string | undefined,
    cwd: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.agent.state.model = model as any;
      existing.agent.state.thinkingLevel = "off";
      if (systemPrompt !== undefined) existing.agent.state.systemPrompt = systemPrompt;
      existing.setActiveToolsByName(buildToolAllowlist(tools));
      return existing;
    }

    // Ensure sessions dir exists (derives dir from the path resolver result)
    const sessionPath = this.pathResolver.pathForConversation(conversationId);
    const sessionsDir = join(sessionPath, "..");
    await mkdir(sessionsDir, { recursive: true });

    const session = await this.sessionFactory({
      tools,
      systemPrompt,
      conversationId,
      model,
      cwd,
      config: this.config,
    });
    this.sessions.set(conversationId, session);
    return session;
  }

  get(conversationId: number): AgentSession | undefined {
    return this.sessions.get(conversationId);
  }

  dispose(conversationId: number): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      try { session.dispose(); } catch { /* ignore */ }
      this.sessions.delete(conversationId);
    }
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      try { session.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }
}
