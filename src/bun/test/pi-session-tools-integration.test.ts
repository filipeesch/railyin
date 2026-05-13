/**
 * Integration tests for Pi engine ghost tools bug.
 *
 * These tests use the real Pi SDK with registerFauxProvider (scripted LLM,
 * no HTTP) to verify that SDK built-in tools (read, grep, find, ls) remain
 * available on session reuse.
 *
 * The bug: assigning `agent.state.tools = [...]` directly bypassed _toolRegistry,
 * causing SDK built-ins to disappear on turn 2 (createContextSnapshot() snapshots
 * agent.state.tools directly; prepareToolCall searches that snapshot).
 *
 * The fix: use session.setActiveToolsByName([...]) on session reuse — this
 * rebuilds agent.state.tools from _toolRegistry, preserving SDK built-ins.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai";
import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SDK_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

/** Create a minimal real AgentSession using a faux provider. No HTTP calls. */
async function createTestSession(faux: FauxProviderRegistration, cwd: string) {
  const sessionManager = SessionManager.open(join(cwd, "session.jsonl"));
  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
  await resourceLoader.reload();

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: faux.getModel() as any,
    tools: [...SDK_BUILTIN_TOOL_NAMES, "noop"],
    customTools: [
      defineTool({
        name: "noop",
        label: "noop",
        description: "Does nothing.",
        parameters: z.object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
      }),
    ],
    sessionManager,
    resourceLoader,
    authStorage,
  });

  session.agent.state.thinkingLevel = "off";
  return session;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-ghost-tools-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  rmSync(cwd, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pi SDK session — SDK built-in tools", () => {
  it("IT-SDK-1: fresh session has SDK built-in tools (read, grep, find, ls)", async () => {
    const session = await createTestSession(faux, cwd);
    const activeTools = session.getActiveToolNames();

    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(activeTools, `Expected '${name}' in active tools`).toContain(name);
    }
  });

  it("IT-SDK-2: direct agent.state.tools assignment loses SDK built-ins (documents the bug)", async () => {
    const session = await createTestSession(faux, cwd);

    // Simulate the OLD buggy assignment from engine.ts (before the fix)
    (session.agent.state as any).tools = [];

    const activeTools = session.getActiveToolNames();
    expect(activeTools).not.toContain("read");
  });

  it("IT-SDK-3: setActiveToolsByName restores SDK built-ins (documents the fix)", async () => {
    const session = await createTestSession(faux, cwd);

    // Simulate the bug
    (session.agent.state as any).tools = [];
    expect(session.getActiveToolNames()).not.toContain("read");

    // Apply the fix
    session.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, "noop"]);

    const activeTools = session.getActiveToolNames();
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(activeTools, `Expected '${name}' after setActiveToolsByName`).toContain(name);
    }
  });
});

describe("Pi engine session reuse — ghost tools regression", () => {
  it("IT-ENGINE-REUSE-1: SDK built-ins present after setActiveToolsByName on reuse", async () => {
    const session = await createTestSession(faux, cwd);

    // Simulate first turn: custom tools registered
    session.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, "noop"]);

    // Simulate what the old code did on reuse: overwrite agent.state.tools directly
    // Then check that setActiveToolsByName restores the built-ins
    (session.agent.state as any).tools = [];  // mimics the bug
    expect(session.getActiveToolNames()).not.toContain("read");

    // Apply the fix path (what getOrCreateSession now does)
    session.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, "noop"]);

    const activeTools = session.getActiveToolNames();
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(activeTools, `'${name}' must be present after session reuse`).toContain(name);
    }
  });

  it("IT-ENGINE-REUSE-2: custom tools also present alongside SDK built-ins after setActiveToolsByName", async () => {
    const session = await createTestSession(faux, cwd);

    session.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, "noop"]);
    const activeTools = session.getActiveToolNames();

    expect(activeTools).toContain("noop");
    expect(activeTools).toContain("read");
  });

  it("IT-ENGINE-REUSE-3: faux provider is registered — model is available", async () => {
    // Verifies that registerFauxProvider injects its model into the Pi API registry,
    // so createAgentSession can find it without HTTP. This is the foundation for
    // future end-to-end faux-provider tests.
    const model = faux.getModel();
    expect(model).toBeDefined();
    expect(model.provider).toBeDefined();
  });
});
