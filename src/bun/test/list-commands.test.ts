import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { collectClaudeCommands, ClaudeEngine } from "../engine/claude/engine.ts";
import { CopilotDialect } from "../engine/dialects/copilot-dialect.ts";
import type { CommandInfo } from "../engine/types.ts";
import { MockClaudeSdkAdapter } from "./support/claude-sdk-mock.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import type { Database } from "bun:sqlite";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "railyn-cmd-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── CopilotDialect.listCommands ─────────────────────────────────────────────

describe("CopilotDialect.listCommands", () => {
  it("returns empty array for non-existent directory", () => {
    const dialect = new CopilotDialect();
    const result = dialect.listCommands(join(tmpDir, "nonexistent-worktree"));
    expect(result).toEqual([]);
  });

  it("lists .prompt.md files as commands", () => {
    const dir = join(tmpDir, ".github", "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-command.prompt.md"), "# My command");
    writeFileSync(join(dir, "other-cmd.prompt.md"), "# Other");

    const dialect = new CopilotDialect();
    const result = dialect.listCommands(tmpDir);

    const names = result.map((c) => c.name).sort();
    expect(names).toEqual(["my-command", "other-cmd"]);
  });

  it("ignores non-.prompt.md files", () => {
    const dir = join(tmpDir, ".github", "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.md"), "# Readme");
    writeFileSync(join(dir, "cmd.prompt.md"), "# cmd");

    const dialect = new CopilotDialect();
    const result = dialect.listCommands(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("cmd");
  });

  it("deduplicates by name across worktree and project (first-wins)", () => {
    const worktreeRoot = join(tmpDir, "worktree");
    const projectRoot = join(tmpDir, "project");
    const worktreeDir = join(worktreeRoot, ".github", "prompts");
    const projectDir = join(projectRoot, ".github", "prompts");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(worktreeDir, "shared.prompt.md"), "From worktree");
    writeFileSync(join(projectDir, "shared.prompt.md"), "From project");
    writeFileSync(join(projectDir, "project-only.prompt.md"), "Project only");

    const dialect = new CopilotDialect();
    const result = dialect.listCommands(worktreeRoot, projectRoot);

    expect(result).toHaveLength(2);
    const names = result.map((c) => c.name).sort();
    expect(names).toEqual(["project-only", "shared"]);
  });

  it("project takes priority over worktree in dedup", () => {
    const worktreeRoot = join(tmpDir, "worktree");
    const projectRoot = join(tmpDir, "project");
    const worktreeDir = join(worktreeRoot, ".github", "prompts");
    const projectDir = join(projectRoot, ".github", "prompts");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(worktreeDir, "shared.prompt.md"), "From worktree");
    writeFileSync(join(projectDir, "shared.prompt.md"), "From project");

    const dialect = new CopilotDialect();
    const result = dialect.listCommands(worktreeRoot, projectRoot);

    // Only one 'shared' entry — from projectPath (first priority)
    const shared = result.filter((c) => c.name === "shared");
    expect(shared).toHaveLength(1);
  });

  it("handles unreadable directory gracefully", () => {
    const dialect = new CopilotDialect();
    expect(() => dialect.listCommands(join(tmpDir, "nonexistent-worktree"))).not.toThrow();
  });
});

// ─── collectClaudeCommands ────────────────────────────────────────────────────

describe("collectClaudeCommands", () => {
  it("returns empty for non-existent directory", () => {
    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(join(tmpDir, ".claude", "commands"), "", seen, out);
    expect(out).toEqual([]);
  });

  it("lists .md files as commands (stem is name)", () => {
    const dir = join(tmpDir, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-task.md"), "# My task");
    writeFileSync(join(dir, "plan.md"), "# Plan");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(dir, "", seen, out);

    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["my-task", "plan"]);
  });

  it("ignores non-.md files", () => {
    const dir = join(tmpDir, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "cmd.md"), "# cmd");
    writeFileSync(join(dir, "readme.txt"), "not a command");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(dir, "", seen, out);

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("cmd");
  });

  it("recurses into subdirectories with colon separator", () => {
    const dir = join(tmpDir, ".claude", "commands");
    const subDir = join(dir, "opsx");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(dir, "top-level.md"), "# top");
    writeFileSync(join(subDir, "propose.md"), "# propose");
    writeFileSync(join(subDir, "apply.md"), "# apply");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(dir, "", seen, out);

    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["opsx:apply", "opsx:propose", "top-level"]);
  });

  it("recursion uses prefix correctly for nested subdirs", () => {
    const dir = join(tmpDir, ".claude", "commands");
    const subDir = join(dir, "a", "b");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "cmd.md"), "# cmd");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(dir, "", seen, out);

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("a:b:cmd");
  });

  it("deduplicates across multiple calls (first wins)", () => {
    const dir1 = join(tmpDir, "worktree", ".claude", "commands");
    const dir2 = join(tmpDir, "home", ".claude", "commands");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir1, "shared.md"), "From worktree");
    writeFileSync(join(dir2, "shared.md"), "From home");
    writeFileSync(join(dir2, "home-only.md"), "Home only");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectClaudeCommands(dir1, "", seen, out);
    collectClaudeCommands(dir2, "", seen, out);

    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["home-only", "shared"]);
  });
});

// ─── Personal scope (CopilotDialect — home dir scanning) ─────────────────────

describe("CopilotDialect.listCommands — personal scope", () => {
  it.skip("includes commands from personal scope path", () => {
    // Cannot inject custom home dir into CopilotDialect.listCommands — uses homedir() internally
  });

  it.skip("personal scope commands are deduped when worktree already has same name", () => {
    // Cannot inject custom home dir into CopilotDialect.listCommands — uses homedir() internally
  });
});

// ─── ClaudeEngine.listCommands — path resolution ──────────────────────────────

describe("ClaudeEngine.listCommands — path resolution", () => {
  let db: Database;
  let projectDir: string;
  let worktreeDir: string;
  let configCleanup: () => void;

  beforeEach(() => {
    db = initDb(); // Must run first so RAILYN_DB=":memory:" is set before setupTestConfig
    projectDir = mkdtempSync(join(tmpdir(), "railyn-proj-"));
    worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const cfg = setupTestConfig("", projectDir);
    configCleanup = cfg.cleanup;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(worktreeDir, { recursive: true, force: true });
    configCleanup();
  });

  it("passes projectPath as cwd to sdkAdapter.listCommands", async () => {
    const { taskId } = seedProjectAndTask(db, worktreeDir);

    const capturedCwds: string[] = [];
    const adapter = new MockClaudeSdkAdapter();
    const origListCommands = adapter.listCommands.bind(adapter);
    adapter.listCommands = async (cwd: string) => {
      capturedCwds.push(cwd);
      return origListCommands(cwd);
    };

    const engine = new ClaudeEngine(undefined, () => {}, () => {}, adapter);
    await engine.listCommands(taskId);

    expect(capturedCwds).toHaveLength(1);
    expect(capturedCwds[0]).toBe(projectDir);
  });

  it("falls back to worktree_path when projectPath is not found", async () => {
    // Use a board with a project_key that doesn't exist in config — project lookup returns null
    const { boardId, taskId } = seedProjectAndTask(db, worktreeDir);
    // Override project_key to something unknown so getProjectByKey returns null
    db.run("UPDATE tasks SET project_key = 'nonexistent-project' WHERE id = ?", [taskId]);
    // Seed git context so fallback uses worktree_path
    db.run(
      "INSERT INTO task_git_context (task_id, worktree_path, git_root_path, branch_name) VALUES (?, ?, ?, ?)",
      [taskId, worktreeDir, worktreeDir, "main"],
    );

    const capturedCwds: string[] = [];
    const adapter = new MockClaudeSdkAdapter();
    adapter.listCommands = async (cwd: string) => {
      capturedCwds.push(cwd);
      return [];
    };

    const engine = new ClaudeEngine(undefined, () => {}, () => {}, adapter);
    await engine.listCommands(taskId);

    expect(capturedCwds).toHaveLength(1);
    expect(capturedCwds[0]).toBe(worktreeDir);
  });

  it("returns empty array when task row does not exist", async () => {
    const adapter = new MockClaudeSdkAdapter();
    const engine = new ClaudeEngine(undefined, () => {}, () => {}, adapter);

    const result = await engine.listCommands(999999);

    expect(result).toEqual([]);
  });

  it("maps SDK commands to CommandInfo shape", async () => {
    const { taskId } = seedProjectAndTask(db, worktreeDir);

    const adapter = new MockClaudeSdkAdapter();
    adapter.listCommands = async (_cwd: string) => [
      { name: "opsx:apply", description: "Apply a change" },
      { name: "opsx:propose", description: "" },
    ];

    const engine = new ClaudeEngine(undefined, () => {}, () => {}, adapter);
    const commands = await engine.listCommands(taskId);

    expect(commands).toEqual([
      { name: "opsx:apply", description: "Apply a change" },
      { name: "opsx:propose", description: undefined },
    ]);
  });
});
