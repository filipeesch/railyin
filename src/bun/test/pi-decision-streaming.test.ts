/**
 * Pi engine streaming decision_request — end-to-end with a faux provider.
 *
 * Drives PiEngine.execute() with a scripted faux model that calls
 * `decision_request` three times (single question per call) and then ends its
 * turn. Asserts:
 *   - page events (`decision_request_page`) stream during the run
 *   - the turn-end flush emits the terminal `decision_request` (not `done`)
 *   - the terminal payload carries all three buffered questions
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { ExecutionParams, EngineEvent } from "../engine/types.ts";
import { SDK_BUILTIN_TOOL_NAMES } from "../engine/pi/constants.ts";

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-decision-stream-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  rmSync(cwd, { recursive: true, force: true });
});

async function createFauxSessionFactory(options: {
  tools: any[];
  systemPrompt: string | undefined;
  conversationId: number;
  model: any;
  cwd: string;
  config: PiEngineConfig;
}) {
  const { tools, systemPrompt, conversationId, cwd, config } = options;
  const model = faux.getModel();

  const sessionManager = SessionManager.open(join(cwd, `session-${conversationId}.jsonl`));
  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    ...(systemPrompt ? { systemPromptOverride: () => systemPrompt } : {}),
  });
  await resourceLoader.reload();

  const authStorage = AuthStorage.inMemory();
  for (const [provider, cfg] of Object.entries(config.providers ?? {})) {
    authStorage.setRuntimeApiKey(provider, cfg.api_key ?? "no-key");
  }
  authStorage.setRuntimeApiKey(model.provider, config.providers?.[model.provider]?.api_key ?? "no-key");

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

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model as any,
    customTools: piTools,
    tools: [...SDK_BUILTIN_TOOL_NAMES, ...piTools.map((t) => t.name)],
    sessionManager,
    resourceLoader,
    authStorage,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
  });

  session.agent.state.thinkingLevel = "off";
  return session;
}

async function drainEvents(gen: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("Pi engine — streaming decision_request via faux provider", () => {
  it("streams page events and emits terminal decision_request at turn end", async () => {
    const config: PiEngineConfig = {
      type: "pi",
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      providers: {
        [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" },
      },
    };

    const engine = new PiEngine(
      "test-pi",
      config,
      () => {},
      () => {},
      undefined,
      new NullModelSettingsRepository(),
      createFauxSessionFactory as any,
    );

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("decision_request", {
        question: "Q1",
        type: "freetext",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("decision_request", {
        question: "Q2",
        type: "freetext",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("decision_request", {
        question: "Q3",
        type: "freetext",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxText("Done asking.")),
    ]);

    const params: ExecutionParams = {
      executionId: 1,
      taskId: null,
      conversationId: 1,
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      workingDirectory: cwd,
      prompt: "Ask the user three questions.",
      signal: new AbortController().signal,
      boardTools: {} as never,
      contextWindowOverride: 128_000,
    };

    const events = await drainEvents(engine.execute(params));

    const pages = events.filter((e) => e.type === "decision_request_page");
    expect(pages).toHaveLength(3);

    const terminal = events.find((e) => e.type === "decision_request");
    expect(terminal).toBeDefined();
    const payload = JSON.parse((terminal as { payload: string }).payload) as { questions: Array<{ question: string }> };
    expect(payload.questions.map((q) => q.question)).toEqual(["Q1", "Q2", "Q3"]);

    // No `done` when the interview was flushed instead.
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
