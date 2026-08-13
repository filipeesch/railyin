/**
 * Factory for lightweight child sessions used by the delegate fan-out tool.
 *
 * Child sessions are fully in-memory (SessionManager.inMemory()) so they
 * produce no on-disk session files. Each child is a pure function:
 * (systemPrompt, tools, prompt) → final assistant text.
 */

import {
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { PiEngineConfig } from "../../config/index.ts";
import type { PiApiMode } from "./api-mode.ts";
import { createPiAgentSession } from "./pi-session-factory.ts";

/**
 * Short instruction appended to the parent system prompt for child sessions.
 * Kept under 300 tokens to avoid crowding context on small local models.
 */
const SUBAGENT_SYSTEM_SUFFIX = `

# Subagent instructions
You are a delegated subagent. Your task is provided in the user message.
- You CAN read and edit files and run shell commands to complete your task.
- You share the parent's working directory with sibling subagents running in parallel. Stay strictly within the files/scope named in your task — editing files outside your assigned scope can clobber a sibling's work.
- You do NOT have the \`delegate\` tool and CANNOT spawn further subagents.
- Do NOT create, move, or edit board tasks, and do NOT record decisions — those belong to the parent. You may use todo tools to track your own work.
- When done, produce a concise final summary of what you changed and any follow-up the parent should handle.`;

export interface ChildSessionOptions {
  /** Unique job identifier, used only for debug logging. */
  jobId: string;
  /** Tools pre-built for this child session. */
  tools: AgentTool<any>[];
  /** Parent model — child reuses the same provider/model. */
  model: Model<PiApiMode>;
  /** Engine config — used to set up auth and compaction settings. */
  config: PiEngineConfig;
  /** Parent system prompt. The subagent suffix is appended automatically. */
  parentSystemPrompt: string | undefined;
  /** Parent's resolved thinking level. Child inherits this instead of hardcoded "off". */
  thinkingLevel?: string;
  /** Working directory (parent's worktree path). */
  cwd: string;
}

/** A live child session that must be disposed after use. */
export interface ChildSessionHandle {
  session: AgentSession;
  dispose(): void;
}

/**
 * Injectable factory for creating child agent sessions.
 * The default implementation uses the Pi SDK with an in-memory SessionManager.
 * Tests inject a factory that returns scripted mock sessions.
 */
export type ChildSessionFactory = (opts: ChildSessionOptions) => Promise<ChildSessionHandle>;

/**
 * Production child session factory.
 * Uses SessionManager.inMemory() — no disk writes, no cleanup needed.
 */
export const defaultChildSessionFactory: ChildSessionFactory = async (opts) => {
  const { tools, model, config, parentSystemPrompt, thinkingLevel, cwd } = opts;

  const systemPrompt = parentSystemPrompt
    ? parentSystemPrompt + SUBAGENT_SYSTEM_SUFFIX
    : SUBAGENT_SYSTEM_SUFFIX.trim();

  const sessionManager = SessionManager.inMemory(cwd);
  // Disable auto-compaction for child sessions — they're short-lived.
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });

  const session = await createPiAgentSession({
    config,
    model,
    tools,
    cwd,
    systemPrompt,
    sessionManager,
    settingsManager,
    // Preserve the legacy behavior: child sessions default to "off" when the
    // parent has no resolved thinking level.
    thinkingLevel: thinkingLevel ?? "off",
  });

  return {
    session,
    dispose: () => {
      try { session.dispose(); } catch { /* ignore */ }
    },
  };
};
