/**
 * Session memory unit tests.
 *
 * These are pure unit tests for the session-memory module: file I/O helpers,
 * formatting, and the extraction trigger path inside the engine. No real
 * AI calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Override RAILYN_DB before importing anything that touches the DB
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { handleHumanTurn } from "../workflow/engine.ts";
import { queueStreamStep, resetFakeAI, getCapturedStreamMessages } from "../ai/fake.ts";
import {
  getSessionMemoryPath,
  readSessionMemory,
  writeSessionMemory,
  formatSessionNotesBlock,
  SESSION_MEMORY_MAX_CHARS,
} from "../workflow/session-memory.ts";
import type { Database } from "bun:sqlite";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let db: Database;
let configCleanup: () => void;

// Use RAILYN_SESSION_MEMORY_DIR to isolate file writes to a temp directory
const origSessionDir = process.env.RAILYN_SESSION_MEMORY_DIR;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "railyn-session-mem-"));
  process.env.RAILYN_SESSION_MEMORY_DIR = tmpDir;

  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  if (origSessionDir !== undefined) {
    process.env.RAILYN_SESSION_MEMORY_DIR = origSessionDir;
  } else {
    delete process.env.RAILYN_SESSION_MEMORY_DIR;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  configCleanup();
  resetFakeAI();
});

// ─── 6.1: readSessionMemory returns null when no file exists ─────────────────

describe("readSessionMemory", () => {
  it("6.1 returns null when no notes file exists for the task", () => {
    const result = readSessionMemory(99999);
    expect(result).toBeNull();
  });

  it("6.1b returns the file content after it has been written", () => {
    writeSessionMemory(1, "# My Notes\n\nSome context here.");
    const result = readSessionMemory(1);
    expect(result).toBe("# My Notes\n\nSome context here.");
  });
});

// ─── 6.2: writeSessionMemory + readSessionMemory round-trip ──────────────────

describe("writeSessionMemory", () => {
  it("6.2 round-trips content correctly", () => {
    const content = "## Open Decisions\n\n- None\n\n## Key Files Changed\n\n- src/foo.ts — added bar function";
    writeSessionMemory(42, content);
    expect(readSessionMemory(42)).toBe(content);
  });

  it("6.2b overwrites previous content on second write", () => {
    writeSessionMemory(1, "first");
    writeSessionMemory(1, "second");
    expect(readSessionMemory(1)).toBe("second");
  });

  it("6.2c creates parent directories automatically", () => {
    const path = getSessionMemoryPath(123);
    expect(existsSync(path)).toBe(false);
    writeSessionMemory(123, "hello");
    expect(existsSync(path)).toBe(true);
  });
});

// ─── 6.3: formatSessionNotesBlock wraps content correctly ────────────────────

describe("formatSessionNotesBlock", () => {
  it("6.3 wraps notes in <session_context> XML tags", () => {
    const block = formatSessionNotesBlock("Some notes content.");
    expect(block).toContain("<session_context>");
    expect(block).toContain("</session_context>");
    expect(block).toContain("Some notes content.");
  });

  it("6.3c does NOT use the old ## Session Notes heading", () => {
    const block = formatSessionNotesBlock("x");
    expect(block).not.toContain("## Session Notes");
  });

  it("6.3b block starts with a newline to separate from preceding content", () => {
    const block = formatSessionNotesBlock("x");
    expect(block.startsWith("\n")).toBe(true);
  });
});

// ─── 6.4: long notes are truncated from the top ──────────────────────────────

describe("formatSessionNotesBlock truncation", () => {
  it("6.4 notes within limit are not truncated", () => {
    const notes = "a".repeat(100);
    const block = formatSessionNotesBlock(notes);
    expect(block).toContain(notes);
  });

  it("6.4b notes exceeding SESSION_MEMORY_MAX_CHARS are sliced from the top", () => {
    // Build a string that clearly exceeds the limit: OLD_CONTENT_ at the start
    // followed by enough filler + a _NEW_TAIL suffix that should survive truncation.
    const notes = "OLD_CONTENT_" + "x".repeat(SESSION_MEMORY_MAX_CHARS + 500) + "_NEW_TAIL";
    // The tail should appear; the very beginning (OLD_CONTENT_) should be cut
    const block = formatSessionNotesBlock(notes);
    expect(block).toContain("_NEW_TAIL");
    expect(block).not.toContain("OLD_CONTENT_");
  });
});

// ─── 6.5: engine injects session notes into assembled messages ────────────────
//
// We write session notes for the task, then trigger a handleHumanTurn and
// verify that the captured stream messages include a system message containing
// the session notes block.

describe("engine session notes injection", () => {
  it("6.5 assembleMessages includes session notes system message when notes file exists", async () => {
    const { taskId } = seedProjectAndTask(db, tmpDir);

    // Write session notes for this task
    writeSessionMemory(taskId, "## Open Decisions\n\nNone.\n\n## Key Files Changed\n\nNone.");

    // Queue a simple final text response so the execution completes
    queueStreamStep({ type: "text", tokens: ["Done."] });

    // handleHumanTurn fires runExecution async; wait for it to finish
    let resolveExec!: () => void;
    const execDone = new Promise<void>((r) => { resolveExec = r; });
    const onTaskUpdated = (task: { executionState: string }) => {
      if (task.executionState === "completed" || task.executionState === "failed") resolveExec();
    };

    await handleHumanTurn(taskId, "hello", noop, noop, onTaskUpdated as never, noop);
    await execDone;

    // getCapturedStreamMessages returns one entry per stream() call;
    // the first entry is the first AI call
    const allCaptured = getCapturedStreamMessages();
    expect(allCaptured.length).toBeGreaterThan(0);
    const firstCallMessages = allCaptured[0];
    // Session notes are now injected into the final user message as <session_context>,
    // NOT as a separate system block.  Verify the user message contains the XML wrapper.
    const userMessages = firstCallMessages.filter(
      (m) => m.role === "user" && typeof m.content === "string",
    );
    const notesMsg = userMessages.find(
      (m) => (m.content as string).includes("<session_context>"),
    );
    expect(notesMsg).toBeDefined();
    expect((notesMsg!.content as string)).toContain("Open Decisions");
    // Verify notes do NOT appear in any system block
    const systemMessages = firstCallMessages.filter((m) => m.role === "system");
    const leakedToSystem = systemMessages.some(
      (m) => (m.content as string)?.includes("session_context") || (m.content as string)?.includes("Open Decisions"),
    );
    expect(leakedToSystem).toBe(false);
  });

  it("6.5b no session notes system message when notes file absent", async () => {
    const { taskId } = seedProjectAndTask(db, tmpDir);

    // Ensure no notes file
    rmSync(getSessionMemoryPath(taskId), { force: true });

    queueStreamStep({ type: "text", tokens: ["Done."] });

    let resolveExec!: () => void;
    const execDone = new Promise<void>((r) => { resolveExec = r; });
    const onTaskUpdated = (task: { executionState: string }) => {
      if (task.executionState === "completed" || task.executionState === "failed") resolveExec();
    };

    await handleHumanTurn(taskId, "hello", noop, noop, onTaskUpdated as never, noop);
    await execDone;

    const allCaptured = getCapturedStreamMessages();
    expect(allCaptured.length).toBeGreaterThan(0);
    const firstCallMessages = allCaptured[0];
    // No session_context XML should appear anywhere in the messages
    const notesMsg = firstCallMessages.find(
      (m) =>
        typeof m.content === "string" &&
        (m.content as string).includes("<session_context>"),
    );
    expect(notesMsg).toBeUndefined();
  });
});

// ─── 1.4: System blocks stable when session notes change ─────────────────────

describe("assembleMessages — system stability with session notes", () => {
  it("1.4 system messages are identical across two runs when only session notes differ", async () => {
    const { taskId } = seedProjectAndTask(db, tmpDir);

    // Helper to run one turn and capture its first AI call messages
    async function runTurn(message: string): Promise<typeof import("../ai/types.ts").AIMessage[]> {
      let resolveExec!: () => void;
      const execDone = new Promise<void>((r) => { resolveExec = r; });
      const onTaskUpdated = (task: { executionState: string }) => {
        if (task.executionState === "completed" || task.executionState === "failed") resolveExec();
      };
      queueStreamStep({ type: "text", tokens: ["Done."] });
      await handleHumanTurn(taskId, message, noop, noop, onTaskUpdated as never, noop);
      await execDone;
      const captured = getCapturedStreamMessages();
      const msgs = captured[captured.length - 1] ?? [];
      resetFakeAI();
      return msgs;
    }

    // First run: no session notes
    rmSync(getSessionMemoryPath(taskId), { force: true });
    const run1Messages = await runTurn("first message");

    // Second run: with session notes written
    writeSessionMemory(taskId, "## Notes\n\nImportant context.");
    const run2Messages = await runTurn("second message");

    // System messages should be byte-identical between runs
    const extractSystem = (msgs: typeof run1Messages) =>
      msgs.filter((m) => m.role === "system").map((m) => m.content as string).join("\0");
    expect(extractSystem(run1Messages)).toBe(extractSystem(run2Messages));
  });
});

function noop() { }
