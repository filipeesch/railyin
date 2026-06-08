import { describe, it, expect, beforeEach } from "vitest";
import { executeCommonTool } from "../engine/common-tools.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { initDb } from "./helpers.ts";
import type { CommonToolContext } from "../engine/types.ts";

let ctx: CommonToolContext;

beforeEach(() => {
  const db = initDb();
  // Seed a conversations row so the FK constraint on task_notes is satisfied
  db.run("INSERT INTO conversations (id, task_id) VALUES (1, NULL)");
  db.run("INSERT INTO conversations (id, task_id) VALUES (2, NULL)");

  const wsRepo = new WorkspaceRepository(db);
  ctx = {
    task: { id: 1, boardId: 1, conversationId: 1 },
    workspaceKey: "default",
    repos: {
      todos: new TodoRepository(db),
      decisions: new DecisionRepository(db),
      notes: new NoteRepository(db),
      boardTools: new BoardToolExecutor(db, wsRepo),
      projects: { listByWorkspace: () => [] },
    },
    workflow: {
      onTransition: () => {},
      onHumanTurn: () => {},
      onCancel: () => {},
      onTaskUpdated: () => {},
    },
    runtime: {},
  };
});

// ─── create_note ──────────────────────────────────────────────────────────────

describe("create_note", () => {
  it("CNT-1: returns string containing the note id", async () => {
    const result = await executeCommonTool("create_note", { content: "Hello world" }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toMatch(/Note #\d+ created\./);
    }
  });

  it("CNT-2: persists the note so listByConversation returns it", async () => {
    await executeCommonTool("create_note", { content: "Persisted note" }, ctx);
    const notes = ctx.repos.notes.listByConversation(1);
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("Persisted note");
  });

  it("CNT-3: empty content returns error", async () => {
    const result = await executeCommonTool("create_note", { content: "" }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toBe("Error: content is required");
    }
  });

  it("CNT-4: whitespace-only content returns error", async () => {
    const result = await executeCommonTool("create_note", { content: "   " }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toBe("Error: content is required");
    }
  });
});

// ─── list_notes ───────────────────────────────────────────────────────────────

describe("list_notes", () => {
  it("LNT-1: returns no-notes message when none exist", async () => {
    const result = await executeCommonTool("list_notes", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toContain("No notes found");
    }
  });

  it("LNT-2: returns both notes' content when two notes exist", async () => {
    ctx.repos.notes.createNote(1, { content: "First note", isSourceAi: true });
    ctx.repos.notes.createNote(1, { content: "Second note", isSourceAi: true });

    const result = await executeCommonTool("list_notes", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.detailedContent).toContain("First note");
      expect(parsed.detailedContent).toContain("Second note");
    }
  });

  it("LNT-3: does not return notes from a different conversationId", async () => {
    // Seed a note at conversationId 2 — should NOT appear when listing for conversation 1
    ctx.repos.notes.createNote(2, { content: "Other conv note", isSourceAi: true });

    const result = await executeCommonTool("list_notes", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toContain("No notes found");
    }
  });

  it("LNT-4: returned string contains the note id prefixed with #", async () => {
    ctx.repos.notes.createNote(1, { content: "Note with id", isSourceAi: true });

    const result = await executeCommonTool("list_notes", {}, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      const parsed = JSON.parse(result.text);
      expect(parsed.detailedContent).toMatch(/#\d+:/);
    }
  });
});

// ─── update_note ──────────────────────────────────────────────────────────────

describe("update_note", () => {
  it("UNT-1: returns success string (not starting with Error:)", async () => {
    const note = ctx.repos.notes.createNote(1, { content: "Original", isSourceAi: true });
    const result = await executeCommonTool("update_note", { id: note.id, content: "Updated" }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).not.toMatch(/^Error:/);
      expect(result.text).toContain(`Note #${note.id} updated.`);
    }
  });

  it("UNT-2: updated content is persisted in subsequent list_notes", async () => {
    const note = ctx.repos.notes.createNote(1, { content: "Original content", isSourceAi: true });
    await executeCommonTool("update_note", { id: note.id, content: "New content" }, ctx);

    const listResult = await executeCommonTool("list_notes", {}, ctx);
    expect(listResult.type).toBe("result");
    if (listResult.type === "result") {
      const parsed = JSON.parse(listResult.text);
      expect(parsed.detailedContent).toContain("New content");
      expect(parsed.detailedContent).not.toContain("Original content");
    }
  });

  it("UNT-3: empty content returns error", async () => {
    const note = ctx.repos.notes.createNote(1, { content: "Original", isSourceAi: true });
    const result = await executeCommonTool("update_note", { id: note.id, content: "" }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toBe("Error: content is required");
    }
  });

  it("UNT-4: whitespace-only content returns error", async () => {
    const note = ctx.repos.notes.createNote(1, { content: "Original", isSourceAi: true });
    const result = await executeCommonTool("update_note", { id: note.id, content: "  " }, ctx);
    expect(result.type).toBe("result");
    if (result.type === "result") {
      expect(result.text).toBe("Error: content is required");
    }
  });
});
