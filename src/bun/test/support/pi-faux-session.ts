/**
 * Shared test-support helpers for Pi SDK faux-provider integration tests.
 *
 * The faux provider (`registerFauxProvider` from `@earendil-works/pi-ai/compat`)
 * scripts LLM responses with no HTTP, letting tests drive the REAL Pi SDK agent
 * loop. These helpers centralize the session setup that used to be duplicated
 * across five test files — and route it through the PRODUCTION
 * `createPiAgentSession` factory so the real ModelRuntime-backed session path is
 * exercised (instead of test-only copies of the factory).
 *
 * The provider registered into the ModelRuntime is aligned with the faux
 * registration's api (default `openai-completions`) so the provider registration
 * and the faux model agree.
 */

import { join } from "path";
import {
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SettingsManager as SettingsManagerType,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import type { PiEngineConfig } from "../../config/index.ts";
import type { PiApiMode } from "../../engine/pi/api-mode.ts";
import { createPiAgentSession } from "../../engine/pi/pi-session-factory.ts";
import { DEFAULT_PROVIDER_BASE_URL } from "../../engine/pi/model-runtime-builder.ts";

/** In-memory settings matching the production parent-session defaults. */
export function defaultFauxSettingsManager(): SettingsManagerType {
  return SettingsManager.inMemory({
    compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  });
}

/** Engine config for a single faux provider (the common fixture shape). */
export function fauxEngineConfig(faux: FauxProviderRegistration): PiEngineConfig {
  const provider = faux.getModel().provider;
  return {
    type: "pi",
    model: `pi/${provider}/${faux.getModel().id}`,
    providers: {
      [provider]: { base_url: DEFAULT_PROVIDER_BASE_URL, api: faux.api as PiApiMode },
    },
  };
}

/** Force the faux provider's api onto the engine config (provider-level override). */
export function alignFauxApi(config: PiEngineConfig, faux: FauxProviderRegistration): PiEngineConfig {
  const provider = faux.getModel().provider;
  const existing = config.providers?.[provider];
  return {
    ...config,
    providers: {
      ...config.providers,
      [provider]: {
        base_url: existing?.base_url ?? DEFAULT_PROVIDER_BASE_URL,
        api: faux.api as PiApiMode,
        ...(existing?.api_key !== undefined && { api_key: existing.api_key }),
        ...(existing?.max_inflight !== undefined && { max_inflight: existing.max_inflight }),
        ...(existing?.queue_timeout_ms !== undefined && { queue_timeout_ms: existing.queue_timeout_ms }),
      },
    },
  };
}

export interface CreateFauxAgentSessionOptions {
  /** Faux provider registration (from `registerFauxProvider()`). */
  faux: FauxProviderRegistration;
  /** Temp working directory. */
  cwd: string;
  /** Railyin-native tools to register on the session. Default: none. */
  tools?: AgentTool<any>[];
  /** Resolved system prompt; only set as the override when non-empty. */
  systemPrompt?: string;
  /** Session file name for the disk-backed session manager. Default: "session.jsonl". */
  sessionFile?: string;
  /** Engine config used to build the ModelRuntime. Defaults to `fauxEngineConfig(faux)`. */
  config?: PiEngineConfig;
  /** SDK settings; defaults to `defaultFauxSettingsManager()`. */
  settingsManager?: SettingsManagerType;
  /** Thinking level applied after creation. Default: "off" (legacy test behavior). */
  thinkingLevel?: string;
  /** Extra fields spread over the faux model (e.g. `contextWindow` for compaction tests). */
  modelOverrides?: Record<string, unknown>;
}

/**
 * Create a real AgentSession against the faux provider through the production
 * `createPiAgentSession` factory. No HTTP calls.
 */
export async function createFauxAgentSession(
  opts: CreateFauxAgentSessionOptions,
): Promise<AgentSession> {
  const {
    faux,
    cwd,
    tools = [],
    systemPrompt,
    sessionFile = "session.jsonl",
    config,
    settingsManager,
    thinkingLevel = "off",
    modelOverrides,
  } = opts;

  const sessionManager = SessionManager.open(join(cwd, sessionFile));
  const model = { ...faux.getModel(), ...(modelOverrides ?? {}) } as any;

  return createPiAgentSession({
    config: config ? alignFauxApi(config, faux) : fauxEngineConfig(faux),
    model: model as any,
    tools,
    cwd,
    systemPrompt,
    sessionManager,
    settingsManager: settingsManager ?? defaultFauxSettingsManager(),
    thinkingLevel,
  });
}

/** Options accepted by the engine-compatible faux SessionFactory. */
export interface FauxSessionFactoryArgs {
  tools: AgentTool<any>[];
  systemPrompt: string | undefined;
  conversationId: number;
  model: unknown;
  cwd: string;
  config: PiEngineConfig;
}

/**
 * Build a PiEngine-compatible `SessionFactory` that creates sessions against the
 * faux provider via the production factory. The engine's config is used (with
 * the faux provider's api aligned) so the ModelRuntime registers the provider.
 */
export function createFauxSessionFactory(faux: FauxProviderRegistration) {
  return async (options: FauxSessionFactoryArgs): Promise<AgentSession> => {
    const { tools, systemPrompt, conversationId, cwd, config } = options;
    return createFauxAgentSession({
      faux,
      cwd,
      tools,
      systemPrompt,
      sessionFile: `session-${conversationId}.jsonl`,
      config,
    });
  };
}

/**
 * Run one faux turn and wait for the agent to finish.
 * The faux provider must already have `setResponses` called before this.
 *
 * Waits for BOTH agent_end (agent loop complete) AND session.prompt() to return
 * (session-level post-processing complete).
 */
export function runTurn(session: AgentSession, promptText: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("runTurn timed out"));
    }, 5000);
    let promptResolved = false;
    let agentEnded = false;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_end") {
        agentEnded = true;
        maybeResolve();
      }
    });

    // Start the prompt and wait for it to fully complete (including post-run hooks)
    const promptPromise = session.prompt(promptText);
    promptPromise
      .then(() => {
        promptResolved = true;
        maybeResolve();
      })
      .catch((err) => {
        clearTimeout(timeout);
        unsubscribe();
        reject(err);
      });

    function maybeResolve() {
      if (agentEnded && promptResolved) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    }
  });
}
