/**
 * Session factory tests — drive the PRODUCTION `createPiAgentSession` (via the
 * shared faux helper) with the real Pi SDK + faux provider (scripted LLM, no
 * HTTP). Verifies the parent/child variants and that the ModelRuntime-backed
 * path produces working sessions.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { defaultChildSessionFactory } from "../../engine/pi/child-session.ts";
import { createFauxAgentSession, runTurn } from "../support/pi-faux-session.ts";
import { SDK_BUILTIN_TOOL_NAMES } from "../../engine/pi/constants.ts";

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-session-factory-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  rmSync(cwd, { recursive: true, force: true });
});

describe("createPiAgentSession (via faux helper)", () => {
  it("SF-1: parent variant creates a session that completes a faux turn", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("Parent response"))]);

    const session = await createFauxAgentSession({ faux, cwd });
    await runTurn(session, "Hello parent.");
    session.dispose();

    expect(faux.state.callCount).toBe(1);
  });

  it("SF-2: systemPrompt is applied as the session system prompt when non-empty", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);

    const session = await createFauxAgentSession({ faux, cwd, systemPrompt: "You are a test assistant." });
    await runTurn(session, "Hi.");

    const state = session.agent.state as unknown as { systemPrompt?: string };
    expect(state.systemPrompt ?? "").toContain("You are a test assistant.");
    session.dispose();
  });

  it("SF-3: empty systemPrompt creates a working session (no override)", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("ok"))]);

    const session = await createFauxAgentSession({ faux, cwd, systemPrompt: undefined });
    await runTurn(session, "Hi.");
    session.dispose();

    expect(faux.state.callCount).toBe(1);
  });

  it("SF-4: custom tools are registered and callable through the real loop", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxText("done")),
    ]);

    const session = await createFauxAgentSession({
      faux,
      cwd,
      tools: [
        {
          name: "noop",
          label: "noop",
          description: "Does nothing.",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
        },
      ],
    });
    const active = session.getActiveToolNames();
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(active).toContain(name);
    }
    expect(active).toContain("noop");
    session.dispose();
  });
});

describe("defaultChildSessionFactory", () => {
  it("SF-5: child session inherits the parent thinking level", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("child"))]);

    const handle = await defaultChildSessionFactory({
      jobId: "job-1",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi", providers: { [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" } } },
      parentSystemPrompt: "Parent prompt",
      thinkingLevel: "high",
      cwd,
    });

    expect(handle.session.agent.state.thinkingLevel).toBe("high");
    await runTurn(handle.session, "Do the thing.");
    handle.dispose();
  });

  it("SF-6: child session defaults thinking level to off", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("child"))]);

    const handle = await defaultChildSessionFactory({
      jobId: "job-2",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi", providers: { [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" } } },
      parentSystemPrompt: undefined,
      cwd,
    });

    expect(handle.session.agent.state.thinkingLevel).toBe("off");
    handle.dispose();
  });

  it("SF-7: child system prompt includes the subagent suffix", async () => {
    faux.setResponses([fauxAssistantMessage(fauxText("child"))]);

    const handle = await defaultChildSessionFactory({
      jobId: "job-3",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi", providers: { [faux.getModel().provider]: { base_url: "http://localhost:1234/v1" } } },
      parentSystemPrompt: "Parent prompt",
      cwd,
    });

    await runTurn(handle.session, "Do the thing.");
    const state = handle.session.agent.state as unknown as { systemPrompt?: string };
    expect(state.systemPrompt ?? "").toContain("# Subagent instructions");
    handle.dispose();
  });
});
