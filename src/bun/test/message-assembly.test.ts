/**
 * Tests for message assembly (assembleMessages + compactMessages).
 *
 * These are integration tests that drive handleHumanTurn/handleTransition and
 * inspect the messages actually passed to the AI provider.  They guard against:
 *
 *  - Task title/description not reaching the model
 *  - stage_instructions not reaching the model
 *  - UI-only messages (system, transition_event, file_diff, ask_user_prompt)
 *    leaking into the LLM context
 *  - tool_call / tool_result history being sent with wrong roles (e.g. as "user")
 *  - assistant-with-tool-calls needing content:null (not content:"")
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { handleHumanTurn, appendMessage } from "../workflow/engine.ts";
import {
  queueStreamStep,
  getCapturedStreamMessages,
  resetFakeAI,
} from "../ai/fake.ts";
import type { Database } from "bun:sqlite";
import type { AIMessage } from "../ai/types.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();

  gitDir = mkdtempSync(join(tmpdir(), "railyn-msg-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;");
  execSync("git add . && git commit -m init", { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
  resetFakeAI();
});

function noop() {}

/** Run a single handleHumanTurn and wait for the stream to finish, then return
 *  the first set of messages sent to the AI provider. */
async function runAndCapture(
  taskId: number,
  message = "Go.",
): Promise<AIMessage[]> {
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  await handleHumanTurn(
    taskId,
    message,
    (_, __, _t, isDone) => { if (isDone) resolveDone(); },
    noop,
    noop,
    noop,
  );
  await done;
  const captured = getCapturedStreamMessages();
  return captured[0] ?? [];
}

// ─── Task title and description ───────────────────────────────────────────────

describe("assembleMessages — task context", () => {
  it("injects the task title into a system message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET title = 'Implement dark mode', workflow_state = 'plan' WHERE id = ?", [taskId]);

    const msgs = await runAndCapture(taskId);

    const systemContents = msgs
      .filter((m) => m.role === "system")
      .map((m) => m.content as string);
    expect(systemContents.some((c) => c.includes("Implement dark mode"))).toBe(true);
  });

  it("injects the task description into a system message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run(
      "UPDATE tasks SET description = 'Support both light and dark themes', workflow_state = 'plan' WHERE id = ?",
      [taskId],
    );

    const msgs = await runAndCapture(taskId);

    const systemContents = msgs
      .filter((m) => m.role === "system")
      .map((m) => m.content as string);
    expect(systemContents.some((c) => c.includes("Support both light and dark themes"))).toBe(true);
  });

  it("still includes a task system message when description is empty", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET title = 'My task', description = '', workflow_state = 'plan' WHERE id = ?", [taskId]);

    const msgs = await runAndCapture(taskId);

    const taskMsg = msgs.find(
      (m) => m.role === "system" && (m.content as string).includes("My task"),
    );
    expect(taskMsg).not.toBeUndefined();
  });
});

// ─── stage_instructions ───────────────────────────────────────────────────────

describe("assembleMessages — stage_instructions", () => {
  it("prepends stage_instructions as the first system message when present", async () => {
    // The 'plan' column in delivery.yaml has stage_instructions
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const msgs = await runAndCapture(taskId, "Plan this.");

    // stage_instructions should be the very first message
    expect(msgs[0].role).toBe("system");
    expect((msgs[0].content as string).toLowerCase()).toMatch(/planning phase|planning/);
  });
});

// ─── UI-only messages excluded from LLM context ───────────────────────────────

describe("compactMessages — UI-only message exclusion", () => {
  it("does not send 'system' type DB messages (e.g. 'Running prompt: plan') to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Inject a UI-only system message into history
    appendMessage(taskId, conversationId, "system", null, "Running prompt: plan");

    const msgs = await runAndCapture(taskId, "Continue.");

    // The exact string "Running prompt: plan" must not appear in any LLM message
    const leaked = msgs.some((m) => (m.content as string)?.includes("Running prompt: plan"));
    expect(leaked).toBe(false);
  });

  it("does not send transition_event messages to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(taskId, conversationId, "transition_event", null, "", {
      from: "backlog",
      to: "plan",
    });

    const msgs = await runAndCapture(taskId, "What next?");

    expect(msgs.every((m) => m.role !== "transition_event" as string)).toBe(true);
  });

  it("does not send ask_user_prompt messages to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(
      taskId,
      conversationId,
      "ask_user_prompt" as "system",
      null,
      JSON.stringify({ question: "Which approach?", selection_mode: "single", options: ["A", "B"] }),
    );

    const msgs = await runAndCapture(taskId, "I choose A.");

    const leaked = msgs.some((m) => (m.content as string)?.includes("Which approach?"));
    expect(leaked).toBe(false);
  });

  it("does not send file_diff messages to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(
      taskId,
      conversationId,
      "file_diff" as "system",
      null,
      JSON.stringify({ operation: "write_file", path: "src/foo.ts", added: 5, removed: 2 }),
    );

    const msgs = await runAndCapture(taskId, "Done.");

    const leaked = msgs.some((m) => (m.content as string)?.includes("write_file"));
    expect(leaked).toBe(false);
  });

  it("does not send reasoning messages to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(
      taskId,
      conversationId,
      "reasoning" as "system",
      null,
      "Let me think step by step about this problem…",
    );

    const msgs = await runAndCapture(taskId, "What did you conclude?");

    const leaked = msgs.some((m) => (m.content as string)?.includes("Let me think step by step"));
    expect(leaked).toBe(false);
  });
});

// ─── tool_call / tool_result history reconstruction ──────────────────────────

describe("compactMessages — tool history reconstruction", () => {
  it("converts tool_call history into assistant message with tool_calls array", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Seed history: prior assistant preamble + tool_call + tool_result
    appendMessage(taskId, conversationId, "user", "user", "List the files.");
    appendMessage(taskId, conversationId, "assistant", "assistant", "Sure, let me look.");
    appendMessage(
      taskId,
      conversationId,
      "tool_call",
      null,
      JSON.stringify({ name: "list_dir", arguments: '{"path":"."}' }),
    );
    appendMessage(taskId, conversationId, "tool_result", null, "src/\npackage.json", {
      tool_call_id: "call_abc",
      name: "list_dir",
    });

    const msgs = await runAndCapture(taskId, "What else?");

    // Find the reconstructed assistant+tool_calls message
    const assistantToolMsg = msgs.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistantToolMsg).not.toBeUndefined();
    expect(assistantToolMsg!.tool_calls![0].function.name).toBe("list_dir");
    // content must be null (not empty string) for OpenAI-compat APIs
    expect(assistantToolMsg!.content).toBeNull();

    // Find the tool result message
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg).not.toBeUndefined();
    expect(toolMsg!.content).toContain("src/");
    expect(toolMsg!.tool_call_id).toBe("call_abc");
    expect((toolMsg as any).name).toBe("list_dir");
  });

  it("does not send an orphaned tool_result (no preceding tool_call) to the LLM", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(taskId, conversationId, "user", "user", "Hmm.");
    appendMessage(taskId, conversationId, "tool_result", null, "orphan output", {
      tool_call_id: "call_orphan",
      name: "list_dir",
    });

    const msgs = await runAndCapture(taskId, "Continue.");

    // No "tool" role message should appear — the orphan must be skipped
    expect(msgs.some((m) => m.role === "tool")).toBe(false);
  });

  it("preserves tool_call_id from tool_result metadata", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(taskId, conversationId, "user", "user", "Check something.");
    appendMessage(
      taskId,
      conversationId,
      "tool_call",
      null,
      JSON.stringify({ name: "read_file", arguments: '{"path":"package.json"}' }),
    );
    appendMessage(taskId, conversationId, "tool_result", null, '{"name":"railyin"}', {
      tool_call_id: "call_xyz123",
      name: "read_file",
    });

    const msgs = await runAndCapture(taskId, "Thanks.");

    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_xyz123");

    const assistantMsg = msgs.find((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistantMsg?.tool_calls![0].id).toBe("call_xyz123");
  });

  it("handles multiple consecutive tool_call+result pairs in history", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(taskId, conversationId, "user", "user", "Explore.");
    // First tool pair
    appendMessage(
      taskId, conversationId, "tool_call", null,
      JSON.stringify({ name: "list_dir", arguments: '{"path":"."}' }),
    );
    appendMessage(taskId, conversationId, "tool_result", null, "src/\ntest/", {
      tool_call_id: "call_1",
      name: "list_dir",
    });
    // Second tool pair
    appendMessage(
      taskId, conversationId, "tool_call", null,
      JSON.stringify({ name: "read_file", arguments: '{"path":"package.json"}' }),
    );
    appendMessage(taskId, conversationId, "tool_result", null, '{"name":"railyin"}', {
      tool_call_id: "call_2",
      name: "read_file",
    });

    const msgs = await runAndCapture(taskId, "What do you see?");

    const toolMsgs = msgs.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(2);
    expect(toolMsgs[0].tool_call_id).toBe("call_1");
    expect(toolMsgs[1].tool_call_id).toBe("call_2");

    const assistantToolMsgs = msgs.filter((m) => m.role === "assistant" && m.tool_calls?.length);
    expect(assistantToolMsgs.length).toBe(2);
  });

  it("truncates very long tool_result content in history", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    appendMessage(taskId, conversationId, "user", "user", "Big output.");
    appendMessage(
      taskId, conversationId, "tool_call", null,
      JSON.stringify({ name: "read_file", arguments: '{"path":"big.txt"}' }),
    );
    // Content larger than TOOL_RESULT_MAX_CHARS (20_000)
    const hugContent = "x".repeat(25_000);
    appendMessage(taskId, conversationId, "tool_result", null, hugContent, {
      tool_call_id: "call_big",
      name: "read_file",
    });

    const msgs = await runAndCapture(taskId, "What next?");

    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg).not.toBeUndefined();
    expect((toolMsg!.content as string).length).toBeLessThan(25_000);
    expect(toolMsg!.content as string).toContain("[truncated]");
  });
});

// ─── Message order ────────────────────────────────────────────────────────────

describe("assembleMessages — message ordering", () => {
  it("places stage_instructions before task context before history before user message", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET title = 'Order test', workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Add a prior user+assistant exchange to history
    appendMessage(taskId, conversationId, "user", "user", "Earlier message.");
    appendMessage(taskId, conversationId, "assistant", "assistant", "Earlier response.");

    const msgs = await runAndCapture(taskId, "New message.");

    // First message must be a system message (stage_instructions)
    expect(msgs[0].role).toBe("system");

    // system messages must all come before user/assistant messages
    let seenNonSystem = false;
    for (const m of msgs) {
      if (m.role !== "system") seenNonSystem = true;
      if (seenNonSystem) {
        expect(m.role).not.toBe("system");
      }
    }

    // The last message must be the triggering user message
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("New message.");
  });
});
