/**
 * Capture-level E2E for api-mode wiring.
 *
 * Drives PiEngine.execute() with an injected session factory that captures the
 * `Model` PiEngine built (`options.model`), asserting the resolved api mode
 * reaches the session factory — the wiring between config → PiModelBuilder →
 * execution. The session itself is created against the faux provider through
 * the production `createPiAgentSession` path, so the stream still emits tokens
 * followed by `done` (completions round-trip).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { ExecutionParams, EngineEvent } from "../../engine/types.ts";
import { createFauxSessionFactory, type FauxSessionFactoryArgs } from "../support/pi-faux-session.ts";

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-api-mode-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  rmSync(cwd, { recursive: true, force: true });
});

async function drainEvents(gen: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function makeConfig(overrides: Partial<PiEngineConfig> = {}): PiEngineConfig {
  const provider = faux.getModel().provider;
  return {
    type: "pi",
    model: `pi/${provider}/${faux.getModel().id}`,
    providers: {
      [provider]: { base_url: "http://localhost:1234/v1" },
    },
    ...overrides,
  };
}

function makeParams(): ExecutionParams {
  return {
    executionId: 1,
    taskId: null,
    conversationId: 1,
    model: `pi/${faux.getModel().provider}/${faux.getModel().id}`,
    workingDirectory: cwd,
    prompt: "Say hello.",
    signal: new AbortController().signal,
    boardTools: {} as never,
    contextWindowOverride: 128_000,
  };
}

async function runWithCapture(config: PiEngineConfig): Promise<{ capturedApi: string | undefined; events: EngineEvent[] }> {
  const innerFactory = createFauxSessionFactory(faux);
  let capturedApi: string | undefined;
  const capturingFactory = async (options: FauxSessionFactoryArgs) => {
    capturedApi = (options.model as { api?: string } | null)?.api;
    return innerFactory(options);
  };

  faux.setResponses([fauxAssistantMessage(fauxText("Hello from the assistant!"))]);

  const engine = new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new NullModelSettingsRepository(),
    capturingFactory as any,
  );

  const events = await drainEvents(engine.execute(makeParams()));
  return { capturedApi, events };
}

describe("PiEngine api-mode wiring (capture-level)", () => {
  it("AM-E2E-1: engine-level api openai-responses reaches the session factory", async () => {
    const { capturedApi, events } = await runWithCapture(makeConfig({ api: "openai-responses" }));
    expect(capturedApi).toBe("openai-responses");

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("AM-E2E-2: provider override openai-completions reaches the session factory", async () => {
    const provider = faux.getModel().provider;
    const { capturedApi, events } = await runWithCapture(
      makeConfig({
        api: "openai-responses",
        providers: { [provider]: { base_url: "http://localhost:1234/v1", api: "openai-completions" } },
      }),
    );
    expect(capturedApi).toBe("openai-completions");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("AM-E2E-3: absent api defaults to openai-responses at the session factory", async () => {
    const { capturedApi, events } = await runWithCapture(makeConfig());
    expect(capturedApi).toBe("openai-responses");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("AM-E2E-4: engine-level api openai-completions reaches the session factory", async () => {
    const { capturedApi, events } = await runWithCapture(makeConfig({ api: "openai-completions" }));
    expect(capturedApi).toBe("openai-completions");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
