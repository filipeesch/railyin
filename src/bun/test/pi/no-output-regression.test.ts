/**
 * Regression test for the Pi engine "Agent completed with no output" bug.
 *
 * After upgrading @earendil-works/pi-coding-agent to 0.80.3, final SDK events
 * (text deltas and agent_end) can arrive after session.prompt() resolves.
 * The fix is to await session.agent.waitForIdle() before closing the stream.
 *
 * This test drives PiEngine.execute() end-to-end with a faux provider (scripted
 * responses, no HTTP) and asserts that the assistant text is streamed before
 * the done event.
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
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { ExecutionParams, EngineEvent } from "../../engine/types.ts";
import { SDK_BUILTIN_TOOL_NAMES } from "../../engine/pi/constants.ts";

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-no-output-"));
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
  // Ignore the model built by PiEngine and use the faux provider's model so the
  // SDK routes inference to the scripted faux provider.
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

describe("Pi no-output regression", () => {
  it("REG-1: engine emits assistant tokens before done with faux provider", async () => {
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

    faux.setResponses([fauxAssistantMessage(fauxText("Hello from the assistant!"))]);

    const params: ExecutionParams = {
      executionId: 1,
      taskId: null,
      conversationId: 1,
      model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
      workingDirectory: cwd,
      prompt: "Say hello.",
      signal: new AbortController().signal,
      boardTools: {} as any,
      contextWindowOverride: 128_000,
    };

    const events = await drainEvents(engine.execute(params));

    const tokens = events.filter((e): e is Extract<EngineEvent, { type: "token" }> => e.type === "token" && "content" in e && typeof e.content === "string");
    const done = events.find((e) => e.type === "done");
    const fullText = tokens.map((t) => t.content).join("");

    expect(tokens.length).toBeGreaterThan(0);
    expect(fullText).toContain("Hello from the assistant!");
    expect(done).toBeDefined();
  });
});
