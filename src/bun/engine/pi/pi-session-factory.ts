/**
 * createPiAgentSession — shared production factory for Pi agent sessions.
 *
 * Both the parent session factory (`defaultSessionFactory` in engine.ts) and the
 * child (delegate) session factory (`defaultChildSessionFactory` in
 * child-session.ts) used to duplicate ~90% of their setup: defineTool wrapping,
 * resource loader, ModelRuntime/auth wiring, tool allowlist, and the
 * `createAgentSession` call. This module consolidates that path so the real
 * production factory is exercised directly by the faux-provider integration
 * tests (instead of test-only copies).
 *
 * The callers parameterize the differences:
 * - session manager — disk-backed (`SessionManager.open(path)`) for parent
 *   sessions, in-memory (`SessionManager.inMemory(cwd)`) for child sessions,
 * - system prompt — passed as the override only when non-empty (parent), or
 *   always with the subagent suffix appended (child),
 * - thinking level — applied to the session after creation (child inherits the
 *   parent's resolved level; parent leaves the SDK default).
 */

import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
  type AgentSession,
  type SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { PiEngineConfig } from "../../config/index.ts";
import type { PiApiMode } from "./api-mode.ts";
import { buildPiModelRuntime } from "./model-runtime-builder.ts";
import { buildToolAllowlist } from "./constants.ts";

export interface CreatePiAgentSessionOptions {
  /** Engine config — used to build the ModelRuntime and resolve api modes. */
  config: PiEngineConfig;
  /** The pi-ai Model for this session (carries the resolved api mode). */
  model: Model<PiApiMode>;
  /** Railyin-native tools to register as custom tools on the session. */
  tools: AgentTool<any>[];
  /** Working directory. */
  cwd: string;
  /**
   * Resolved system prompt. When non-empty it is supplied as the SDK
   * `systemPromptOverride`; an empty/undefined prompt means no override
   * (prevents empty system prompts for bare chat sessions).
   */
  systemPrompt: string | undefined;
  /** Session persistence — disk-backed for parent sessions, in-memory for children. */
  sessionManager: SessionManager;
  /** SDK settings (compaction disabled; per-caller tuning). */
  settingsManager: SettingsManager;
  /** Optional thinking level applied after creation (child sessions inherit the parent's). */
  thinkingLevel?: string;
}

/**
 * Create a Pi agent session via the Pi SDK.
 *
 * Wraps the Railyin tools into SDK `defineTool` definitions, builds a
 * `ModelRuntime` from engine config (providers + api modes), and registers the
 * SDK built-in tools + custom tool names in the allowlist.
 */
export async function createPiAgentSession(options: CreatePiAgentSessionOptions): Promise<AgentSession> {
  const { config, model, tools, cwd, systemPrompt, sessionManager, settingsManager, thinkingLevel } = options;

  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    // Only pass systemPromptOverride when the resolved system prompt is non-empty.
    // Passing an override that returns undefined can yield an empty system prompt
    // for chat sessions, which may degrade behavior.
    ...(systemPrompt ? { systemPromptOverride: () => systemPrompt } : {}),
  });
  await resourceLoader.reload();

  const piTools = tools.map((t) =>
    defineTool({
      name: t.name,
      label: t.label ?? t.name,
      description: t.description,
      parameters: t.parameters as any,
      prepareArguments: t.prepareArguments,
      execute: t.execute as any,
    }),
  );

  const modelRuntime = await buildPiModelRuntime(config);

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model as any,
    customTools: piTools,
    tools: buildToolAllowlist(piTools),
    sessionManager,
    resourceLoader,
    modelRuntime,
    settingsManager,
  });

  if (thinkingLevel !== undefined) {
    session.agent.state.thinkingLevel = thinkingLevel as never;
  }

  return session;
}
