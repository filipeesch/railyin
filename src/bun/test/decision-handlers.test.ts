import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { taskHandlers } from "../handlers/tasks.ts";
import { chatSessionHandlers } from "../handlers/chat-sessions.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { WorktreeManager } from "../git/WorktreeManager.ts";
import { GitRepositoryManager } from "../git/GitRepositoryManager.ts";
import { TaskGitContextRepository } from "../db/repositories/TaskGitContextRepository.ts";
import type { IProjectResolver } from "../git/IProjectResolver.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { ConversationMessage, DecisionAnswer } from "../../shared/rpc-types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { mapTask } from "../db/mappers.ts";

const TEST_PROJECT_RESOLVER: IProjectResolver = {
  getDefaultBranch: () => "main",
  getWorktreeBasePath: (_wsKey, _projectKey, gitRootPath) => `${gitRootPath}/../worktrees`,
};

let db: Database;
let wsRepo: WorkspaceRepository;
let gitDir: string;
let configCleanup: () => void;
let worktreeManager: WorktreeManager;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-dh-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "hello");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  db = initDb();
  wsRepo = new WorkspaceRepository(db);
  const gitRepo = new GitRepositoryManager();
  worktreeManager = new WorktreeManager(
    db,
    wsRepo,
    TEST_PROJECT_RESOLVER,
    gitRepo,
    new TaskGitContextRepository(db),
  );
  const cfg = setupTestConfig("", gitDir);
  configCleanup = cfg.cleanup;
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── Stub orchestrator ────────────────────────────────────────────────────────

interface CapturedTurn {
  taskId?: number;
  userContent: string;
  engineContent?: string;
}

function makeCapturingOrchestrator(): ExecutionCoordinator & { captured: CapturedTurn[] } {
  const captured: CapturedTurn[] = [];
  let msgCounter = 100;

  const fakeMessage = (conversationId: number) => ({
    id: ++msgCounter,
    taskId: null,
    conversationId,
    role: "user",
    content: "captured",
    type: "user" as const,
    createdAt: new Date().toISOString(),
    metadata: null,
  });

  return {
    captured,
    executeTransition: async (taskId: number, toState: string) => {
      db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);
      const row = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
      return { task: mapTask(row), executionId: null };
    },
    executeHumanTurn: async (taskId: number, content: string, _attachments: unknown, engineContent: string) => {
      captured.push({ taskId, userContent: content, engineContent: engineContent ?? undefined });
      const convId = db.query<{ conversation_id: number }, [number]>(
        "SELECT conversation_id FROM tasks WHERE id = ?"
      ).get(taskId)!.conversation_id;
      return { message: fakeMessage(convId) as ConversationMessage, executionId: 1 };
    },
    executeRetry: async () => { throw new Error("not implemented"); },
    executeCodeReview: async () => { throw new Error("not implemented"); },
    respondShellApprovalByExecution: async () => { throw new Error("not implemented"); },
    executeChatTurn: async (_sessionId: number, convId: number, content: string, _model: unknown, _mcp: unknown, _ws: unknown, _att: unknown, engineContent: string) => {
      captured.push({ userContent: content, engineContent: engineContent ?? undefined });
      return { message: fakeMessage(convId) as ConversationMessage, executionId: 1 };
    },
    cancel: () => {},
    listModels: async () => [],
    compactTask: async () => {},
    compactConversation: async () => {},
    listCommands: async () => [],
    shutdownNonNativeEngines: async () => {},
  } as unknown as ExecutionCoordinator & { captured: CapturedTurn[] };
}

// ─── tasks.submitDecisions ────────────────────────────────────────────────────

describe("tasks.submitDecisions", () => {
  it("DH-1: userContent contains formatted Q&A (visible)", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    const orchestrator = makeCapturingOrchestrator();
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const answers: DecisionAnswer[] = [
      { question: "Use TypeScript?", answer: "Yes", weight: "critical" },
    ];

    await handlers["tasks.submitDecisions"]({ taskId, answers });

    expect(orchestrator.captured[0].userContent).toContain("Use TypeScript?");
    expect(orchestrator.captured[0].userContent).toContain("Yes");
    expect(orchestrator.captured[0].userContent).toContain("[CRITICAL]");
  });

  it("DH-2: engineContent contains hidden instruction to call list_decisions and record_decision", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    const orchestrator = makeCapturingOrchestrator();
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const answers: DecisionAnswer[] = [
      { question: "Use TypeScript?", answer: "Yes", weight: "medium" },
    ];

    await handlers["tasks.submitDecisions"]({ taskId, answers });

    const engineContent = orchestrator.captured[0].engineContent ?? "";
    expect(engineContent).toContain("list_decisions()");
    expect(engineContent).toContain("record_decision");
    expect(engineContent).toContain("update_decision");
  });

  it("DH-3: userContent does NOT contain the hidden instruction", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    const orchestrator = makeCapturingOrchestrator();
    const handlers = taskHandlers(db, wsRepo, orchestrator, () => {}, worktreeManager);

    const answers: DecisionAnswer[] = [
      { question: "Which DB?", answer: "SQLite", weight: "easy" },
    ];

    await handlers["tasks.submitDecisions"]({ taskId, answers });

    expect(orchestrator.captured[0].userContent).not.toContain("list_decisions()");
    expect(orchestrator.captured[0].userContent).not.toContain("NEVER call record_decision");
  });
});

// ─── chatSessions.submitDecisions ────────────────────────────────────────────

describe("chatSessions.submitDecisions", () => {
  it("DH-4: engineContent contains hidden instruction for chat session decisions", async () => {
    const orchestrator = makeCapturingOrchestrator();
    const handlers = chatSessionHandlers(db, () => {}, orchestrator);

    // Create a chat session directly in DB
    const convResult = db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const convId = convResult.lastInsertRowid as number;
    const sessionResult = db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Test Session', 'idle', ?)",
      [convId],
    );
    const sessionId = sessionResult.lastInsertRowid as number;

    const answers: DecisionAnswer[] = [
      { question: "Test question?", answer: "Test answer", weight: "medium" },
    ];

    await handlers["chatSessions.submitDecisions"]({ sessionId, answers });

    const engineContent = orchestrator.captured[0].engineContent ?? "";
    expect(engineContent).toContain("list_decisions()");
    expect(engineContent).toContain("update_decision");
  });
});
