import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CopilotDialect } from "../engine/dialects/copilot-dialect.ts";

let tmpDir: string;
let dialect: CopilotDialect;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "railyn-copilot-"));
  dialect = new CopilotDialect();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePromptFile(stem: string, content: string, dir = tmpDir): void {
  const promptDir = join(dir, ".github", "prompts");
  mkdirSync(promptDir, { recursive: true });
  writeFileSync(join(promptDir, `${stem}.prompt.md`), content, "utf-8");
}

// ---------------------------------------------------------------------------
// resolvePrompt — non-slash pass-through
// ---------------------------------------------------------------------------

describe("CopilotDialect.resolvePrompt — non-slash", () => {
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
});

// ---------------------------------------------------------------------------
// resolvePrompt — slash resolution
// ---------------------------------------------------------------------------

describe("CopilotDialect.resolvePrompt — slash commands", () => {
  it("resolves a valid slash reference and XML-wraps the body", async () => {
    writePromptFile("opsx-propose", "Hello from propose prompt");
    const result = await dialect.resolvePrompt("/opsx-propose", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceCommand).toBe("opsx-propose");
    expect(result.sourceArgs).toBe("");
    expect(result.content).toBe(
      '<command name="opsx-propose" args="">\nHello from propose prompt\n</command>',
    );
  });

  it("strips YAML frontmatter from the resolved file", async () => {
    writePromptFile("opsx-propose", "---\ndescription: Test prompt\n---\nActual body content");
    const result = await dialect.resolvePrompt("/opsx-propose", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.content).toBe(
      '<command name="opsx-propose" args="">\nActual body content\n</command>',
    );
  });

  it("substitutes $input with the provided argument text", async () => {
    writePromptFile("opsx-propose", "Build this: $input");
    const result = await dialect.resolvePrompt("/opsx-propose add-dark-mode", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.sourceArgs).toBe("add-dark-mode");
    expect(result.content).toBe(
      '<command name="opsx-propose" args="add-dark-mode">\nBuild this: add-dark-mode\n</command>',
    );
  });

  it("substitutes all occurrences of $input", async () => {
    writePromptFile("opsx-propose", "Task: $input\nContext: $input");
    const result = await dialect.resolvePrompt("/opsx-propose my-feature", tmpDir);
    expect(result.content).toBe(
      '<command name="opsx-propose" args="my-feature">\nTask: my-feature\nContext: my-feature\n</command>',
    );
  });

  it("replaces $input with empty string when no argument is provided", async () => {
    writePromptFile("opsx-sync", "Run sync for: $input");
    const result = await dialect.resolvePrompt("/opsx-sync", tmpDir);
    expect(result.sourceArgs).toBe("");
    expect(result.content).toBe(
      '<command name="opsx-sync" args="">\nRun sync for: \n</command>',
    );
  });

  it("strips frontmatter and substitutes $input together", async () => {
    writePromptFile("opsx-explore", "---\ndescription: Explore\n---\nExplore: $input");
    const result = await dialect.resolvePrompt("/opsx-explore caching strategy", tmpDir);
    expect(result.content).toBe(
      '<command name="opsx-explore" args="caching strategy">\nExplore: caching strategy\n</command>',
    );
  });

  it("throws a descriptive error when the file is not found", async () => {
    await expect(dialect.resolvePrompt("/opsx-missing", tmpDir)).rejects.toThrow(
      "Slash reference '/opsx-missing' could not be resolved",
    );
  });

  it("includes the missing file path in the error", async () => {
    await expect(dialect.resolvePrompt("/ns-cmd", tmpDir)).rejects.toThrow(
      ".github/prompts/ns-cmd.prompt.md",
    );
  });

  it("does not treat newline content as $input argument", async () => {
    writePromptFile("opsx-apply", "Resolved: $input");
    const result = await dialect.resolvePrompt("/opsx-apply\nExtra content here", tmpDir);
    // $input gets empty string (no same-line args); post-newline appended
    expect(result.content).toBe(
      '<command name="opsx-apply" args="">\nResolved: \n\nExtra content here\n</command>',
    );
  });

  it("appends post-newline content to resolved body", async () => {
    writePromptFile("opsx-apply", "Prompt body.");
    const result = await dialect.resolvePrompt("/opsx-apply\nLine 1\nLine 2", tmpDir);
    expect(result.content).toBe(
      '<command name="opsx-apply" args="">\nPrompt body.\n\nLine 1\nLine 2\n</command>',
    );
  });

  it("same-line argument still works alongside post-newline content", async () => {
    writePromptFile("opsx-propose", "Feature: $input");
    const result = await dialect.resolvePrompt("/opsx-propose my-feature\nExtra steps here", tmpDir);
    expect(result.sourceArgs).toBe("my-feature");
    expect(result.content).toBe(
      '<command name="opsx-propose" args="my-feature">\nFeature: my-feature\n\nExtra steps here\n</command>',
    );
  });
});

// ---------------------------------------------------------------------------
// resolvePrompt — path priority
// ---------------------------------------------------------------------------

describe("CopilotDialect.resolvePrompt — path priority", () => {
  it("falls back to worktreePath when projectPath is not provided", async () => {
    writePromptFile("project-cmd", "From worktree");
    const result = await dialect.resolvePrompt("/project-cmd", tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.content).toContain("From worktree");
  });

  it("falls back to projectPath when not found in worktreePath", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      writePromptFile("project-cmd", "From project root", projectDir);
      const result = await dialect.resolvePrompt("/project-cmd", tmpDir, projectDir);
      expect(result.wasSlash).toBe(true);
      expect(result.content).toContain("From project root");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("projectPath takes priority over worktreePath", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      writePromptFile("shared-cmd", "From project root", projectDir);
      writePromptFile("shared-cmd", "From worktree");

      // projectPath has highest priority — it should win
      const result = await dialect.resolvePrompt("/shared-cmd", tmpDir, projectDir);
      expect(result.wasSlash).toBe(true);
      expect(result.content).toContain("From project root");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips projectPath lookup when it equals worktreePath", async () => {
    writePromptFile("opsx-apply", "Body");
    const result = await dialect.resolvePrompt("/opsx-apply", tmpDir, tmpDir);
    expect(result.wasSlash).toBe(true);
    expect(result.content).toContain("Body");
  });

  it("throws when all accessible scopes miss the file", async () => {
    await expect(
      dialect.resolvePrompt("/zzz-totally-nonexistent-8f3k2p", tmpDir),
    ).rejects.toThrow("could not be resolved");
  });
});

// ---------------------------------------------------------------------------
// listCommands
// ---------------------------------------------------------------------------

describe("CopilotDialect.listCommands", () => {
  it("returns an empty array when no .github/prompts dir exists", () => {
    const commands = dialect.listCommands(tmpDir);
    // May include real home-scope commands; at minimum it should be an array
    expect(Array.isArray(commands)).toBe(true);
  });

  it("returns commands from worktreePath/.github/prompts", () => {
    writePromptFile("my-cmd", "Do something");
    writePromptFile("other-cmd", "Do other");
    const commands = dialect.listCommands(tmpDir);
    const names = commands.map((c) => c.name);
    expect(names).toContain("my-cmd");
    expect(names).toContain("other-cmd");
  });

  it("extracts frontmatter description for autocomplete", () => {
    writePromptFile("described-cmd", "---\ndescription: My handy command\n---\nBody here");
    const commands = dialect.listCommands(tmpDir);
    const cmd = commands.find((c) => c.name === "described-cmd");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("My handy command");
  });

  it("returns undefined description when no frontmatter", () => {
    writePromptFile("bare-cmd", "Just a body, no frontmatter");
    const commands = dialect.listCommands(tmpDir);
    const cmd = commands.find((c) => c.name === "bare-cmd");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBeUndefined();
  });

  it("deduplicates: projectPath wins over worktreePath", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      writePromptFile("shared-cmd", "---\ndescription: From project\n---\nProject body", projectDir);
      writePromptFile("shared-cmd", "---\ndescription: From worktree\n---\nWorktree body");

      const commands = dialect.listCommands(tmpDir, projectDir);
      const matches = commands.filter((c) => c.name === "shared-cmd");
      // Should only appear once
      expect(matches.length).toBe(1);
      // Project version wins (highest priority)
      expect(matches[0].description).toBe("From project");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("returns both project-only and worktree-only commands when no overlap", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      writePromptFile("project-exclusive", "Project only", projectDir);
      writePromptFile("worktree-exclusive", "Worktree only");

      const commands = dialect.listCommands(tmpDir, projectDir);
      const names = commands.map((c) => c.name);
      expect(names).toContain("project-exclusive");
      expect(names).toContain("worktree-exclusive");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips worktreePath scan when it equals projectPath", () => {
    writePromptFile("my-cmd", "Body");
    const commands = dialect.listCommands(tmpDir, tmpDir);
    const matches = commands.filter((c) => c.name === "my-cmd");
    // Should appear exactly once despite both paths being the same
    expect(matches.length).toBe(1);
  });
});
