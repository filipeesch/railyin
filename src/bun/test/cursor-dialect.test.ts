import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CursorDialect } from "../engine/dialects/cursor-dialect.ts";

let tmpDir: string;
let dialect: CursorDialect;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cursor-dialect-test-"));
  dialect = new CursorDialect();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeCommandFile(relativePath: string, content: string, dir = tmpDir): void {
  const commandDir = join(dir, ".cursor", "commands");
  const fullPath = join(commandDir, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// resolvePrompt — non-slash pass-through
// ---------------------------------------------------------------------------

describe("CursorDialect.resolvePrompt — non-slash", () => {
  it("passes non-slash values through unchanged", async () => {
    const result = await dialect.resolvePrompt("just some inline prompt", tmpDir);
    expect(result.wasSlash).toBe(false);
    expect(result.content).toBe("just some inline prompt");
  });

  it("passes empty string through unchanged", async () => {
    const result = await dialect.resolvePrompt("", tmpDir);
    expect(result.wasSlash).toBe(false);
    expect(result.content).toBe("");
  });

  it("passes plain text with spaces through unchanged", async () => {
    const result = await dialect.resolvePrompt("no slash here", tmpDir);
    expect(result.wasSlash).toBe(false);
    expect(result.content).toBe("no slash here");
  });
});

// ---------------------------------------------------------------------------
// resolvePrompt — slash resolution
// ---------------------------------------------------------------------------

describe("CursorDialect.resolvePrompt — slash commands", () => {
  it("resolves a simple command and XML-wraps the body", async () => {
    writeCommandFile("test.md", "Hello from test command");
    const result = await dialect.resolvePrompt("/test", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceCommand).toBe("test");
    expect(result.sourceArgs).toBe("");
    expect(result.content).toBe(
      '<command name="test" args="">\nHello from test command\n</command>',
    );
  });

  it("resolves a subdirectory command using colon-namespacing", async () => {
    writeCommandFile("sub/cmd.md", "Subdir command body");
    const result = await dialect.resolvePrompt("/sub:cmd", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceCommand).toBe("sub:cmd");
    expect(result.sourceArgs).toBe("");
    expect(result.content).toBe(
      '<command name="sub:cmd" args="">\nSubdir command body\n</command>',
    );
  });

  it("resolves a deeply nested command using colon-namespacing", async () => {
    writeCommandFile("a/b/c.md", "Deeply nested body");
    const result = await dialect.resolvePrompt("/a:b:c", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceCommand).toBe("a:b:c");
    expect(result.content).toBe(
      '<command name="a:b:c" args="">\nDeeply nested body\n</command>',
    );
  });

  it("passes args through to the XML wrapper", async () => {
    writeCommandFile("test.md", "Do something with $input");
    const result = await dialect.resolvePrompt("/test my-arg", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceArgs).toBe("my-arg");
    expect(result.content).toBe(
      '<command name="test" args="my-arg">\nDo something with my-arg\n</command>',
    );
  });

  it("substitutes $input in the body with trailing args", async () => {
    writeCommandFile("apply.md", "Apply: $input");
    const result = await dialect.resolvePrompt("/apply dark-mode", tmpDir);
    expect(result.content).toBe(
      '<command name="apply" args="dark-mode">\nApply: dark-mode\n</command>',
    );
  });

  it("substitutes all occurrences of $input", async () => {
    writeCommandFile("multi.md", "Task: $input\nContext: $input");
    const result = await dialect.resolvePrompt("/multi my-feature", tmpDir);
    expect(result.content).toBe(
      '<command name="multi" args="my-feature">\nTask: my-feature\nContext: my-feature\n</command>',
    );
  });

  it("replaces $input with empty string when no argument is provided", async () => {
    writeCommandFile("sync.md", "Run sync for: $input");
    const result = await dialect.resolvePrompt("/sync", tmpDir);
    expect(result.sourceArgs).toBe("");
    expect(result.content).toBe(
      '<command name="sync" args="">\nRun sync for: \n</command>',
    );
  });

  it("does NOT strip YAML frontmatter — entire file goes into XML body", async () => {
    writeCommandFile("described.md", "---\ndescription: My command\n---\nActual body content");
    const result = await dialect.resolvePrompt("/described", tmpDir);
    expect(result.wasSlash).toBe(true);
    // Full content including frontmatter must be present
    expect(result.content).toBe(
      '<command name="described" args="">\n---\ndescription: My command\n---\nActual body content\n</command>',
    );
  });

  it("throws a descriptive error when the command file is not found", async () => {
    await expect(dialect.resolvePrompt("/missing-cmd", tmpDir)).rejects.toThrow(
      "Slash reference '/missing-cmd' could not be resolved",
    );
  });

  it("includes the missing file path in the error", async () => {
    await expect(dialect.resolvePrompt("/ns:missing", tmpDir)).rejects.toThrow(
      "ns/missing.md",
    );
  });

  it("post-newline content is appended to resolved body", async () => {
    writeCommandFile("apply.md", "Prompt body.");
    const result = await dialect.resolvePrompt("/apply\nLine 1\nLine 2", tmpDir);
    expect(result.content).toBe(
      '<command name="apply" args="">\nPrompt body.\n\nLine 1\nLine 2\n</command>',
    );
  });

  it("same-line argument works alongside post-newline content", async () => {
    writeCommandFile("propose.md", "Feature: $input");
    const result = await dialect.resolvePrompt("/propose my-feature\nExtra steps here", tmpDir);
    expect(result.sourceArgs).toBe("my-feature");
    expect(result.content).toBe(
      '<command name="propose" args="my-feature">\nFeature: my-feature\n\nExtra steps here\n</command>',
    );
  });

  it("does not treat newline content as $input argument", async () => {
    writeCommandFile("apply.md", "Resolved: $input");
    const result = await dialect.resolvePrompt("/apply\nExtra content here", tmpDir);
    expect(result.content).toBe(
      '<command name="apply" args="">\nResolved: \n\nExtra content here\n</command>',
    );
  });
});

// ---------------------------------------------------------------------------
// resolvePrompt — path priority
// ---------------------------------------------------------------------------

describe("CursorDialect.resolvePrompt — path priority", () => {
  it("resolves from worktreePath when projectPath is not provided", async () => {
    writeCommandFile("worktree-cmd.md", "From worktree");
    const result = await dialect.resolvePrompt("/worktree-cmd", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.content).toContain("From worktree");
  });

  it("resolves from projectPath when command only exists there", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      writeCommandFile("project-cmd.md", "From project root", projectDir);
      const result = await dialect.resolvePrompt("/project-cmd", tmpDir, projectDir);
      expect(result.wasSlash).toBe(true);
      expect(result.content).toContain("From project root");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("projectPath wins when same command exists in both paths", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      writeCommandFile("shared-cmd.md", "From project root", projectDir);
      writeCommandFile("shared-cmd.md", "From worktree");

      const result = await dialect.resolvePrompt("/shared-cmd", tmpDir, projectDir);
      expect(result.wasSlash).toBe(true);
      expect(result.content).toContain("From project root");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("resolves from worktreePath when command only exists there (projectPath set to another dir)", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      writeCommandFile("worktree-only.md", "From worktree only");
      // projectDir has no commands
      const result = await dialect.resolvePrompt("/worktree-only", tmpDir, projectDir);
      expect(result.wasSlash).toBe(true);
      expect(result.content).toContain("From worktree only");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips duplicate lookup when projectPath equals worktreePath", async () => {
    writeCommandFile("apply.md", "Body");
    const result = await dialect.resolvePrompt("/apply", tmpDir, tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.content).toContain("Body");
  });

  it("throws when command is not found in any scope", async () => {
    await expect(
      dialect.resolvePrompt("/zzz-totally-nonexistent-8f3k2p", tmpDir),
    ).rejects.toThrow("could not be resolved");
  });
});

// ---------------------------------------------------------------------------
// listCommands
// ---------------------------------------------------------------------------

describe("CursorDialect.listCommands", () => {
  it("returns an array even when no .cursor/commands dir exists", () => {
    const commands = dialect.listCommands(tmpDir);
    // CursorDialect has no home scope, so result must be empty
    expect(commands).toHaveLength(0);
  });

  it("returns commands from worktreePath/.cursor/commands", () => {
    writeCommandFile("my-cmd.md", "Do something");
    writeCommandFile("other-cmd.md", "Do other");
    const commands = dialect.listCommands(tmpDir);
    const names = commands.map((c) => c.name);
    expect(names).toContain("my-cmd");
    expect(names).toContain("other-cmd");
  });

  it("returns colon-namespaced commands from subdirectories", () => {
    writeCommandFile("sub/cmd.md", "Subdir command");
    writeCommandFile("a/b/c.md", "Deeply nested");
    const commands = dialect.listCommands(tmpDir);
    const names = commands.map((c) => c.name);
    expect(names).toContain("sub:cmd");
    expect(names).toContain("a:b:c");
  });

  it("extracts frontmatter description for autocomplete", () => {
    writeCommandFile("described.md", "---\ndescription: My handy command\n---\nBody here");
    const commands = dialect.listCommands(tmpDir);
    const cmd = commands.find((c) => c.name === "described");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("My handy command");
  });

  it("returns undefined description when no frontmatter", () => {
    writeCommandFile("bare-cmd.md", "Just a body, no frontmatter");
    const commands = dialect.listCommands(tmpDir);
    const cmd = commands.find((c) => c.name === "bare-cmd");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBeUndefined();
  });

  it("merges commands from projectPath when provided", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      writeCommandFile("project-exclusive.md", "Project only", projectDir);
      writeCommandFile("worktree-exclusive.md", "Worktree only");

      const commands = dialect.listCommands(tmpDir, projectDir);
      const names = commands.map((c) => c.name);
      expect(names).toContain("project-exclusive");
      expect(names).toContain("worktree-exclusive");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("deduplicates: projectPath wins over worktreePath on conflicts", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      writeCommandFile("shared-cmd.md", "---\ndescription: From project\n---\nProject body", projectDir);
      writeCommandFile("shared-cmd.md", "---\ndescription: From worktree\n---\nWorktree body");

      const commands = dialect.listCommands(tmpDir, projectDir);
      const matches = commands.filter((c) => c.name === "shared-cmd");
      expect(matches.length).toBe(1);
      expect(matches[0].description).toBe("From project");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips worktreePath scan when it equals projectPath (no duplicates)", () => {
    writeCommandFile("my-cmd.md", "Body");
    const commands = dialect.listCommands(tmpDir, tmpDir);
    const matches = commands.filter((c) => c.name === "my-cmd");
    expect(matches.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getSkillPaths
// ---------------------------------------------------------------------------

describe("CursorDialect.getSkillPaths", () => {
  it("returns only existing .cursor/skills/ directory", () => {
    const skillsDir = join(tmpDir, ".cursor", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const result = dialect.getSkillPaths(tmpDir);
    expect(result).toEqual([skillsDir]);
  });

  it("returns empty array when .cursor/skills/ does not exist", () => {
    const result = dialect.getSkillPaths(tmpDir);
    expect(result).toEqual([]);
  });

  it("does NOT include ~/.cursor/skills/ (no home scope)", () => {
    // All candidate dirs must be inside tmpDir, not in homedir()
    const skillsDir = join(tmpDir, ".cursor", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const result = dialect.getSkillPaths(tmpDir);
    expect(result.every(p => p.startsWith(tmpDir))).toBe(true);
  });

  it("includes projectPath skills before worktreePath skills when both exist", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      const projSkills = join(projectDir, ".cursor", "skills");
      const wtSkills = join(tmpDir, ".cursor", "skills");
      mkdirSync(projSkills, { recursive: true });
      mkdirSync(wtSkills, { recursive: true });
      const result = dialect.getSkillPaths(tmpDir, projectDir);
      expect(result[0]).toBe(projSkills);
      expect(result[1]).toBe(wtSkills);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips worktreePath when it equals projectPath (no duplicates)", () => {
    const skillsDir = join(tmpDir, ".cursor", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const result = dialect.getSkillPaths(tmpDir, tmpDir);
    expect(result).toHaveLength(1);
  });

  it("returns empty list when no .cursor/skills/ exists in any path", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "cursor-project-"));
    try {
      const result = dialect.getSkillPaths(tmpDir, projectDir);
      expect(result).toEqual([]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
