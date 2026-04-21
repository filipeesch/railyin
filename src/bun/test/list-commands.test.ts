import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { collectClaudeCommands } from "../engine/claude/engine.ts";
import { collectCopilotCommands } from "../engine/copilot/engine.ts";
import type { CommandInfo } from "../engine/types.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "railyn-cmd-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── collectCopilotCommands ────────────────────────────────────────────────────

describe("collectCopilotCommands", () => {
  it("returns empty array for non-existent directory", () => {
    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectCopilotCommands(join(tmpDir, ".github", "prompts"), seen, out);
    expect(out).toEqual([]);
  });

  it("lists .prompt.md files as commands", () => {
    const dir = join(tmpDir, ".github", "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "my-command.prompt.md"), "# My command");
    writeFileSync(join(dir, "other-cmd.prompt.md"), "# Other");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectCopilotCommands(dir, seen, out);

    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["my-command", "other-cmd"]);
  });

  it("ignores non-.prompt.md files", () => {
    const dir = join(tmpDir, ".github", "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.md"), "# Readme");
    writeFileSync(join(dir, "cmd.prompt.md"), "# cmd");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectCopilotCommands(dir, seen, out);

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("cmd");
  });

  it("deduplicates by name across multiple calls (first-wins)", () => {
    const worktreeDir = join(tmpDir, "worktree", ".github", "prompts");
    const projectDir = join(tmpDir, "project", ".github", "prompts");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(worktreeDir, "shared.prompt.md"), "From worktree");
    writeFileSync(join(projectDir, "shared.prompt.md"), "From project");
    writeFileSync(join(projectDir, "project-only.prompt.md"), "Project only");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectCopilotCommands(worktreeDir, seen, out);
    collectCopilotCommands(projectDir, seen, out);

    expect(out).toHaveLength(2);
    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["project-only", "shared"]);
  });

  it("worktree takes priority over project in dedup", () => {
    const worktreeDir = join(tmpDir, "worktree", ".github", "prompts");
    const projectDir = join(tmpDir, "project", ".github", "prompts");
    mkdirSync(worktreeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(worktreeDir, "shared.prompt.md"), "From worktree");
    writeFileSync(join(projectDir, "shared.prompt.md"), "From project");

    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    collectCopilotCommands(worktreeDir, seen, out);
    collectCopilotCommands(projectDir, seen, out);

    // Only one 'shared' entry — from worktree (first wins)
    const shared = out.filter((c) => c.name === "shared");
    expect(shared).toHaveLength(1);
  });

  it("handles unreadable directory gracefully", () => {
    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    // Simulate an error by passing a path that is a file, not a dir
    writeFileSync(join(tmpDir, "notadir"), "file");
    expect(() => collectCopilotCommands(join(tmpDir, "notadir"), seen, out)).not.toThrow();
    expect(out).toEqual([]);
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

// ─── Personal scope (collectCopilotCommands via user home dir) ────────────────

describe("collectCopilotCommands — personal scope", () => {
  it("includes commands from personal scope path", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-"));
    try {
      const personalDir = join(homeDir, ".github", "prompts");
      mkdirSync(personalDir, { recursive: true });
      writeFileSync(join(personalDir, "personal-cmd.prompt.md"), "# Personal");
      writeFileSync(join(personalDir, "another-cmd.prompt.md"), "# Another");

      const seen = new Set<string>();
      const out: CommandInfo[] = [];
      collectCopilotCommands(personalDir, seen, out);

      const names = out.map((c) => c.name).sort();
      expect(names).toEqual(["another-cmd", "personal-cmd"]);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("personal scope commands are deduped when worktree already has same name", () => {
    const worktreeDir = join(tmpDir, "worktree", ".github", "prompts");
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-"));
    try {
      mkdirSync(worktreeDir, { recursive: true });
      writeFileSync(join(worktreeDir, "shared.prompt.md"), "From worktree");

      const personalDir = join(homeDir, ".github", "prompts");
      mkdirSync(personalDir, { recursive: true });
      writeFileSync(join(personalDir, "shared.prompt.md"), "From home");
      writeFileSync(join(personalDir, "home-only.prompt.md"), "Home only");

      const seen = new Set<string>();
      const out: CommandInfo[] = [];
      collectCopilotCommands(worktreeDir, seen, out);
      collectCopilotCommands(personalDir, seen, out);

      // shared should appear once (worktree wins), home-only should appear
      const names = out.map((c) => c.name).sort();
      expect(names).toEqual(["home-only", "shared"]);
      expect(out.filter((c) => c.name === "shared")).toHaveLength(1);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
