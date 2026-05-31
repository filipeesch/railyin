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
  SettingsManager,
  getAgentDir,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { defaultChildSessionFactory } from "../engine/pi/child-session.ts";
import { SDK_BUILTIN_TOOL_NAMES } from "../engine/pi/constants.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// SDK_BUILTIN_TOOL_NAMES imported from constants — see import at top of file.

/** Create a minimal real AgentSession using a faux provider. No HTTP calls. */
async function createTestSession(
  faux: FauxProviderRegistration,
  cwd: string,
  systemPromptOverride?: string,
  compactionOptions?: { contextWindow?: number; reserveTokens?: number },
) {
  const sessionManager = SessionManager.open(join(cwd, "session.jsonl"));
  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    ...(systemPromptOverride !== undefined && { systemPromptOverride: () => systemPromptOverride }),
  });
  await resourceLoader.reload();

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

  const settingsManager = compactionOptions
    ? SettingsManager.inMemory({
        compaction: {
          enabled: true,
          reserveTokens: compactionOptions.reserveTokens ?? 0,
          keepRecentTokens: 1,
        },
      })
    : undefined;

  const model = {
    ...faux.getModel(),
    ...(compactionOptions?.contextWindow !== undefined && {
      contextWindow: compactionOptions.contextWindow,
    }),
  };

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model as any,
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
    ...(settingsManager && { settingsManager }),
  });

  session.agent.state.thinkingLevel = "off";
  return session;
}

/**
 * Run one faux turn and wait for the agent to finish.
 * The faux provider must already have `setResponses` called before this.
 */
function runTurn(session: AgentSession, promptText: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_end") {
        unsubscribe();
        resolve();
      }
    });
    session.prompt(promptText).catch((err) => {
      unsubscribe();
      reject(err);
    });
  });
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

// ─── System Prompt Injection Tests ────────────────────────────────────────────

describe("Pi SDK session — system prompt injection", () => {
  it("IT-SYSPROMPT-1: custom systemPromptOverride is reflected in session.systemPrompt", async () => {
    const session = await createTestSession(faux, cwd, "MY_CUSTOM_PROMPT_MARKER");

    expect(session.systemPrompt).toContain("MY_CUSTOM_PROMPT_MARKER");
  });

  it("IT-SYSPROMPT-2: session without override has a non-empty SDK default system prompt", async () => {
    const session = await createTestSession(faux, cwd);

    expect(typeof session.systemPrompt).toBe("string");
    expect(session.systemPrompt.length).toBeGreaterThan(0);
  });

  it("IT-SYSPROMPT-3: reuse path — direct assignment updates session.systemPrompt (mirrors engine.ts line 638)", async () => {
    const session = await createTestSession(faux, cwd);

    // Mirrors what getOrCreateSession does when systemPrompt !== undefined
    session.agent.state.systemPrompt = "REUSE_PROMPT_B";

    expect(session.systemPrompt).toContain("REUSE_PROMPT_B");
  });

  it("IT-SYSPROMPT-4: reuse path — undefined systemPrompt leaves existing prompt unchanged", async () => {
    const session = await createTestSession(faux, cwd);
    session.agent.state.systemPrompt = "ORIGINAL_PROMPT";

    // Mirrors the guard: if (systemPrompt !== undefined) existing.agent.state.systemPrompt = systemPrompt;
    const systemPrompt: string | undefined = undefined;
    if (systemPrompt !== undefined) session.agent.state.systemPrompt = systemPrompt;

    expect(session.systemPrompt).toBe("ORIGINAL_PROMPT");
  });

  it("IT-SYSPROMPT-5: enrichedSystem construction — taskBlock + systemInstructions joined correctly", () => {
    // Unit test for the inline string composition in createManagedExecution
    const taskBlock = "## Task\n**Title:** My Task\n**Description:** A description";
    const systemInstructions = "Do things carefully.";
    const enrichedSystem = [taskBlock, systemInstructions].filter(Boolean).join("\n\n") || undefined;

    expect(enrichedSystem).toContain("## Task");
    expect(enrichedSystem).toContain("My Task");
    expect(enrichedSystem).toContain("Do things carefully.");
    expect(enrichedSystem).toContain("\n\n");
  });

  it("IT-SYSPROMPT-6: enrichedSystem is undefined when both taskBlock and systemInstructions are falsy", () => {
    const taskBlock = undefined;
    const systemInstructions = undefined;
    const enrichedSystem = [taskBlock, systemInstructions].filter(Boolean).join("\n\n") || undefined;

    expect(enrichedSystem).toBeUndefined();
  });
});

// ─── Compaction SDK Tests ──────────────────────────────────────────────────────

describe("Pi SDK session — manual compaction", () => {
  it("IT-COMPACT-SDK-1: compact() returns a summary and tokensBefore after a turn", async () => {
    const session = await createTestSession(faux, cwd);

    // First response: user turn. Second response: compaction summarization LLM call.
    faux.setResponses([
      fauxAssistantMessage(fauxText("Hello, I am the assistant.")),
      fauxAssistantMessage(fauxText("Summary of the conversation.")),
    ]);
    await runTurn(session, "Say hello.");

    const result = await session.compact();

    expect(result).not.toBeNull();
    expect(typeof result!.summary).toBe("string");
    expect(result!.summary.length).toBeGreaterThan(0);
    expect(result!.tokensBefore).toBeGreaterThan(0);
  });

  it("IT-COMPACT-SDK-2: compact() emits compaction_start (reason=manual) then compaction_end", async () => {
    const session = await createTestSession(faux, cwd);

    faux.setResponses([
      fauxAssistantMessage(fauxText("Hello.")),
      fauxAssistantMessage(fauxText("Compact summary.")),
    ]);
    await runTurn(session, "Say hello.");

    const events: string[] = [];
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "compaction_start" || event.type === "compaction_end") {
        events.push(event.type);
      }
    });

    await session.compact();
    unsubscribe();

    expect(events[0]).toBe("compaction_start");
    expect(events[events.length - 1]).toBe("compaction_end");
    expect(events.filter((e) => e === "compaction_start")).toHaveLength(1);
    expect(events.filter((e) => e === "compaction_end")).toHaveLength(1);
  });

  it("IT-COMPACT-SDK-3: compaction_start carries reason=manual; compaction_end has result with summary", async () => {
    const session = await createTestSession(faux, cwd);

    faux.setResponses([
      fauxAssistantMessage(fauxText("Hello.")),
      fauxAssistantMessage(fauxText("Summary text.")),
    ]);
    await runTurn(session, "Say hello.");

    let startReason: string | undefined;
    let endResult: { summary: string } | undefined;
    let wasCompactingDuringStart = false;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "compaction_start") {
        startReason = event.reason;
        wasCompactingDuringStart = session.isCompacting;
      }
      if (event.type === "compaction_end" && event.result) {
        endResult = event.result as { summary: string };
      }
    });

    await session.compact();
    unsubscribe();

    expect(startReason).toBe("manual");
    expect(wasCompactingDuringStart).toBe(true);
    expect(session.isCompacting).toBe(false);
    expect(endResult?.summary).toBeTruthy();
  });
});

// ─── Compaction Auto-threshold Tests ──────────────────────────────────────────

describe("Pi SDK session — auto-compaction threshold", () => {
  it("IT-COMPACT-AUTO-1: threshold compaction fires when totalTokens > contextWindow - reserveTokens", async () => {
    // contextWindow=200, reserveTokens=0 → threshold at 200.
    // faux provider calculates totalTokens from text length (chars / 4) so any
    // non-trivial prompt will produce >200 tokens once prompt + response > 800 chars.
    // We use a longer prompt to guarantee the faux usage estimate exceeds 200.
    const session = await createTestSession(faux, cwd, undefined, {
      contextWindow: 200,
      reserveTokens: 0,
    });

    const compactionEvents: string[] = [];
    session.subscribe((event) => {
      if (event.type === "compaction_start" || event.type === "compaction_end") {
        compactionEvents.push(event.type);
      }
    });

    // Repeat characters to ensure the faux provider's token estimate exceeds contextWindow
    const longText = "x".repeat(820); // ~205 tokens (820 / 4 = 205)
    faux.setResponses([fauxAssistantMessage(fauxText(longText))]);
    await runTurn(session, longText);

    expect(compactionEvents).toContain("compaction_start");
  });
});

// ─── Child Session (delegate) SDK built-in tool allowlist ────────────────────

describe("Pi delegate — child session SDK built-in tool allowlist", () => {
  it("IT-CHILD-1: defaultChildSessionFactory includes SDK built-ins (read, grep, find, ls) in active tools", async () => {
    const handle = await defaultChildSessionFactory({
      jobId: "test-child",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi" },
      parentSystemPrompt: undefined,
      cwd,
    });

    try {
      const activeTools = handle.session.getActiveToolNames();
      for (const name of SDK_BUILTIN_TOOL_NAMES) {
        expect(activeTools, `Expected SDK built-in '${name}' in child session active tools`).toContain(name);
      }
    } finally {
      handle.dispose();
    }
  });

  it("IT-CHILD-2: child session SDK built-ins are present even when custom tools array is empty", async () => {
    const handle = await defaultChildSessionFactory({
      jobId: "test-child-no-customs",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi" },
      parentSystemPrompt: undefined,
      cwd,
    });

    try {
      const activeTools = handle.session.getActiveToolNames();
      expect(activeTools).toContain("read");
      expect(activeTools).toContain("grep");
      expect(activeTools).toContain("find");
      expect(activeTools).toContain("ls");
    } finally {
      handle.dispose();
    }
  });

  it("IT-CHILD-3: child session includes custom tool names alongside SDK built-ins", async () => {
    const customTool: any = {
      name: "glob",
      label: "Glob",
      description: "Glob files",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "[]" }], details: undefined }),
    };

    const handle = await defaultChildSessionFactory({
      jobId: "test-child-with-custom",
      tools: [customTool],
      model: faux.getModel() as any,
      config: { type: "pi" },
      parentSystemPrompt: undefined,
      cwd,
    });

    try {
      const activeTools = handle.session.getActiveToolNames();
      expect(activeTools).toContain("read");
      expect(activeTools).toContain("glob");
    } finally {
      handle.dispose();
    }
  });

  it("IT-CHILD-4: child session does NOT have 'delegate' tool (no recursive delegation)", async () => {
    const handle = await defaultChildSessionFactory({
      jobId: "test-child-no-delegate",
      tools: [],
      model: faux.getModel() as any,
      config: { type: "pi" },
      parentSystemPrompt: undefined,
      cwd,
    });

    try {
      const activeTools = handle.session.getActiveToolNames();
      expect(activeTools).not.toContain("delegate");
    } finally {
      handle.dispose();
    }
  });
});

// ─── buildToolAllowlist unit tests ────────────────────────────────────────────

import { buildToolAllowlist } from "../engine/pi/constants.ts";

function makeTool(name: string): { name: string } {
  return { name };
}

describe("buildToolAllowlist", () => {
  it("BTL-1: empty tools list returns exactly SDK built-in names", () => {
    const result = buildToolAllowlist([]);
    expect(result).toEqual([...SDK_BUILTIN_TOOL_NAMES]);
  });

  it("BTL-2: custom tools are appended after SDK built-ins", () => {
    const result = buildToolAllowlist([makeTool("create_note"), makeTool("list_notes")]);
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(result).toContain(name);
    }
    expect(result).toContain("create_note");
    expect(result).toContain("list_notes");
    const sdkCount = SDK_BUILTIN_TOOL_NAMES.length;
    expect(result.indexOf("create_note")).toBeGreaterThanOrEqual(sdkCount);
  });

  it("BTL-3: result includes all SDK built-ins and all custom tool names", () => {
    const customTools = [makeTool("create_note"), makeTool("list_notes"), makeTool("update_note")];
    const result = buildToolAllowlist(customTools);
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(result).toContain(name);
    }
    expect(result).toContain("create_note");
    expect(result).toContain("list_notes");
    expect(result).toContain("update_note");
  });

  it("BTL-4: no duplicate entries in the output", () => {
    const tools = [makeTool("create_note"), makeTool("list_notes")];
    const result = buildToolAllowlist(tools);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });
});

// ─── Pi SDK note tool allowlist ───────────────────────────────────────────────

describe("Pi SDK session — note tool allowlist", () => {
  it("IT-NOTE-1: note tools are in session active tools when created with buildToolAllowlist", async () => {
    const noteToolNames = ["create_note", "list_notes", "update_note"];
    const customTools = noteToolNames.map((name) =>
      defineTool({
        name,
        label: name,
        description: `${name} tool`,
        parameters: z.object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
      }),
    );

    const sessionManager = SessionManager.open(join(cwd, "session-note-1.jsonl"));
    const agentDir = getAgentDir();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
    await resourceLoader.reload();
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: faux.getModel() as any,
      tools: buildToolAllowlist(customTools as any),
      customTools,
      sessionManager,
      resourceLoader,
      authStorage,
    });
    session.agent.state.thinkingLevel = "off";

    const activeTools = session.getActiveToolNames();
    for (const name of noteToolNames) {
      expect(activeTools, `Expected '${name}' in active tools after session creation`).toContain(name);
    }
    session.dispose();
  });

  it("IT-NOTE-2: note tools remain present after setActiveToolsByName (session reuse path)", async () => {
    const noteToolNames = ["create_note", "list_notes", "update_note"];
    const customTools = noteToolNames.map((name) =>
      defineTool({
        name,
        label: name,
        description: `${name} tool`,
        parameters: z.object({}),
        execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined }),
      }),
    );

    const sessionManager = SessionManager.open(join(cwd, "session-note-2.jsonl"));
    const agentDir = getAgentDir();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
    await resourceLoader.reload();
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: faux.getModel() as any,
      tools: buildToolAllowlist(customTools as any),
      customTools,
      sessionManager,
      resourceLoader,
      authStorage,
    });
    session.agent.state.thinkingLevel = "off";

    // Simulate session reuse path: re-set the allowlist with buildToolAllowlist
    session.setActiveToolsByName(buildToolAllowlist(customTools as any));

    const activeTools = session.getActiveToolNames();
    for (const name of noteToolNames) {
      expect(activeTools, `Expected '${name}' after setActiveToolsByName`).toContain(name);
    }
    for (const name of SDK_BUILTIN_TOOL_NAMES) {
      expect(activeTools, `Expected SDK built-in '${name}' preserved`).toContain(name);
    }
    session.dispose();
  });

  it("IT-NOTE-3: create_note custom tool persists a note when invoked", async () => {
    const { initDb } = await import("./helpers.ts");
    const { NoteRepository } = await import("../db/repositories/note-repository.ts");

    const db = initDb();
    // Seed a conversation row to satisfy the FK on task_notes.conversation_id
    db.run("INSERT INTO conversations (id, task_id) VALUES (1, NULL)");
    const notes = new NoteRepository(db);
    const conversationId = 1;

    const createNoteTool = defineTool({
      name: "create_note",
      label: "create_note",
      description: "Create a note",
      parameters: z.object({ content: z.string() }),
      execute: async (_callId, params: { content: string }) => {
        const note = notes.createNote(conversationId, { content: params.content, isSourceAi: true });
        return { content: [{ type: "text" as const, text: `Note #${note.id} created.` }], details: undefined };
      },
    });

    // Call execute directly to verify persistence — the allowlist integration is covered by IT-NOTE-1
    await createNoteTool.execute("call-1", { content: "test note" }, undefined, undefined, {} as any);

    const storedNotes = notes.listByConversation(conversationId);
    expect(storedNotes).toHaveLength(1);
    expect(storedNotes[0].content).toBe("test note");
  });
});
