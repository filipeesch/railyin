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

/** Internal session-map entry — tracks the qualified model id a session was built/last-refreshed with. */
interface SessionEntry {
  session: AgentSession;
  qualifiedModelId: string;
}

export class PiSessionManager {
  /** Map<conversationId, SessionEntry> — one Pi session per conversation. */
  readonly sessions = new Map<number, SessionEntry>();

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
    qualifiedModelId: string,
  ): Promise<AgentSession> {
    const entry = this.sessions.get(conversationId);
    if (entry) {
      entry.session.agent.state.model = model as any;
      if (qualifiedModelId !== entry.qualifiedModelId) {
        if (systemPrompt !== undefined) entry.session.agent.state.systemPrompt = systemPrompt;
        entry.qualifiedModelId = qualifiedModelId;
      }
      entry.session.setActiveToolsByName(buildToolAllowlist(tools));
      return entry.session;
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
    this.sessions.set(conversationId, { session, qualifiedModelId });
    return session;
  }

  get(conversationId: number): AgentSession | undefined {
    return this.sessions.get(conversationId)?.session;
  }

  dispose(conversationId: number): void {
    const entry = this.sessions.get(conversationId);
    if (entry) {
      try { entry.session.dispose(); } catch { /* ignore */ }
      this.sessions.delete(conversationId);
    }
  }

  disposeAll(): void {
    for (const entry of this.sessions.values()) {
      try { entry.session.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }
}
