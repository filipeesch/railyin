import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { validateTransition } from "../workflow/transition-validator.ts";

const RESTRICTED_WORKFLOW_YAML = `id: restricted
name: Restricted Flow
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
    allowed_transitions:
      - plan
  - id: plan
    label: Plan
  - id: blocked
    label: Blocked
  - id: done
    label: Done`;

const LIMITED_WORKFLOW_YAML = `id: limited
name: Limited Flow
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: review
    label: Review
    limit: 1
  - id: done
    label: Done`;

let db: Database;
let cleanup: () => void;

beforeEach(() => {
  const cfg = setupTestConfig("", undefined, [RESTRICTED_WORKFLOW_YAML, LIMITED_WORKFLOW_YAML]);
  cleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  cleanup();
});

// ─── TV-1: task not found ─────────────────────────────────────────────────────

describe("validateTransition — TV-1: task not found returns ok:false", () => {
  it("returns ok:false with task not found reason for non-existent task", () => {
    const result = validateTransition(db, 99999, "plan");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("task 99999 not found");
    }
  });
});

// ─── TV-2: invalid target column ──────────────────────────────────────────────

describe("validateTransition — TV-2: invalid target column returns ok:false with valid column list", () => {
  it("returns ok:false with valid column list when target column does not exist", () => {
    const { taskId } = seedProjectAndTask(db, "/test");
    const result = validateTransition(db, taskId, "nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("nonexistent");
      expect(result.reason).toContain("Valid columns:");
    }
  });
});

// ─── TV-3: column at capacity ─────────────────────────────────────────────────

describe("validateTransition — TV-3: column at capacity returns ok:false", () => {
  it("returns ok:false when target column is full (limit=1 with 1 task already there)", () => {
    const { taskId, boardId } = seedProjectAndTask(db, "/test");
    db.run("UPDATE boards SET workflow_template_id = 'limited' WHERE id = ?", [boardId]);

    // Seed a second task and place it in "review" to fill the slot
    const { taskId: task2Id } = seedProjectAndTask(db, "/test2");
    db.run("UPDATE tasks SET workflow_state = 'review', board_id = ? WHERE id = ?", [boardId, task2Id]);

    const result = validateTransition(db, taskId, "review");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("review");
      expect(result.reason).toContain("capacity");
    }
  });
});

// ─── TV-4: allowed_transitions blocks forbidden target ────────────────────────

describe("validateTransition — TV-4: allowed_transitions blocks forbidden target", () => {
  it("returns ok:false when target is not in allowed_transitions of source column", () => {
    const { taskId, boardId } = seedProjectAndTask(db, "/test");
    db.run("UPDATE boards SET workflow_template_id = 'restricted' WHERE id = ?", [boardId]);
    // Move task to backlog (backlog only allows -> plan)
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const result = validateTransition(db, taskId, "blocked");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("backlog");
      expect(result.reason).toContain("blocked");
    }
  });
});

// ─── TV-5: allowed_transitions permits allowed target ────────────────────────

describe("validateTransition — TV-5: allowed_transitions permits allowed target", () => {
  it("returns ok:true when target is listed in allowed_transitions", () => {
    const { taskId, boardId } = seedProjectAndTask(db, "/test");
    db.run("UPDATE boards SET workflow_template_id = 'restricted' WHERE id = ?", [boardId]);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    // backlog -> plan is the one allowed transition
    const result = validateTransition(db, taskId, "plan");
    expect(result.ok).toBe(true);
  });
});

// ─── TV-6: no allowed_transitions → any target is allowed ────────────────────

describe("validateTransition — TV-6: no allowed_transitions → any target is allowed", () => {
  it("allows any transition when source column has no allowed_transitions defined", () => {
    const { taskId } = seedProjectAndTask(db, "/test");
    // Default "delivery" workflow: task starts in "plan" which has no allowed_transitions
    const result = validateTransition(db, taskId, "done");
    expect(result.ok).toBe(true);
  });
});

// ─── TV-7: successful transition returns correct boardId and col objects ──────

describe("validateTransition — TV-7: successful transition returns correct boardId and col objects", () => {
  it("returns boardId, fromCol.id, and toCol.id on a valid transition", () => {
    const { taskId, boardId } = seedProjectAndTask(db, "/test");
    // task starts in "plan"; transition to "done"
    const result = validateTransition(db, taskId, "done");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.boardId).toBe(boardId);
      expect(result.fromCol.id).toBe("plan");
      expect(result.toCol.id).toBe("done");
    }
  });
});
