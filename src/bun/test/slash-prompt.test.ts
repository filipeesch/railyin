import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolvePrompt as resolveSlashReference } from "../engine/dialects/copilot-prompt-resolver.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "railyn-slash-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writePromptFile(stem: string, content: string): void {
  const dir = join(tmpDir, ".github", "prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stem}.prompt.md`), content, "utf-8");
}

describe("resolveSlashReference", () => {
  it("passes non-slash values through unchanged", async () => {
    const result = await resolveSlashReference("just some inline prompt", tmpDir);
    expect(result).toBe("just some inline prompt");
  });

  it("passes empty string through unchanged", async () => {
    const result = await resolveSlashReference("", tmpDir);
    expect(result).toBe("");
  });

  it("resolves a valid slash reference to the file body", async () => {
    writePromptFile("opsx-propose", "Hello from propose prompt");
    const result = await resolveSlashReference("/opsx-propose", tmpDir);
    expect(result).toBe("Hello from propose prompt");
  });

  it("strips YAML frontmatter from the resolved file", async () => {
    writePromptFile("opsx-propose", "---\ndescription: Test prompt\n---\nActual body content");
    const result = await resolveSlashReference("/opsx-propose", tmpDir);
    expect(result).toBe("Actual body content");
  });

  it("substitutes $input with the provided argument text", async () => {
    writePromptFile("opsx-propose", "Build this: $input");
    const result = await resolveSlashReference("/opsx-propose add-dark-mode", tmpDir);
    expect(result).toBe("Build this: add-dark-mode");
  });

  it("substitutes all occurrences of $input", async () => {
    writePromptFile("opsx-propose", "Task: $input\nContext: $input");
    const result = await resolveSlashReference("/opsx-propose my-feature", tmpDir);
    expect(result).toBe("Task: my-feature\nContext: my-feature");
  });

  it("replaces $input with empty string when no argument is provided", async () => {
    writePromptFile("opsx-sync", "Run sync for: $input");
    const result = await resolveSlashReference("/opsx-sync", tmpDir);
    expect(result).toBe("Run sync for: ");
  });

  it("strips frontmatter and substitutes $input together", async () => {
    writePromptFile("opsx-explore", "---\ndescription: Explore\n---\nExplore: $input");
    const result = await resolveSlashReference("/opsx-explore caching strategy", tmpDir);
    expect(result).toBe("Explore: caching strategy");
  });

  it("throws a descriptive error when the file is not found", async () => {
    expect(resolveSlashReference("/opsx-missing", tmpDir)).rejects.toThrow(
      "Slash reference '/opsx-missing' could not be resolved"
    );
  });

  it("includes the missing file path in the error", async () => {
    expect(resolveSlashReference("/ns-cmd", tmpDir)).rejects.toThrow(".github/prompts/ns-cmd.prompt.md");
  });

  it("does not treat newline content as $input argument", async () => {
    writePromptFile("opsx-apply", "Resolved: $input");
    const result = await resolveSlashReference("/opsx-apply\nExtra content here", tmpDir);
    expect(result).toBe("Resolved: \n\nExtra content here");
  });

  it("appends post-newline content to resolved body", async () => {
    writePromptFile("opsx-apply", "Prompt body.");
    const result = await resolveSlashReference("/opsx-apply\nLine 1\nLine 2", tmpDir);
    expect(result).toBe("Prompt body.\n\nLine 1\nLine 2");
  });

  it("same-line argument still works alongside post-newline content", async () => {
    writePromptFile("opsx-propose", "Feature: $input");
    const result = await resolveSlashReference("/opsx-propose my-feature\nExtra steps here", tmpDir);
    expect(result).toBe("Feature: my-feature\n\nExtra steps here");
  });

  it("falls back to projectRootPath when not found in worktreePath", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      const projectPromptDir = join(projectDir, ".github", "prompts");
      mkdirSync(projectPromptDir, { recursive: true });
      writeFileSync(join(projectPromptDir, "project-cmd.prompt.md"), "From project root", "utf-8");

      const result = await resolveSlashReference("/project-cmd", tmpDir, projectDir);
      expect(result).toBe("From project root");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("worktreePath takes priority over projectRootPath", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    try {
      const projectPromptDir = join(projectDir, ".github", "prompts");
      mkdirSync(projectPromptDir, { recursive: true });
      writeFileSync(join(projectPromptDir, "shared-cmd.prompt.md"), "From project root", "utf-8");
      writePromptFile("shared-cmd", "From worktree");

      const result = await resolveSlashReference("/shared-cmd", tmpDir, projectDir);
      expect(result).toBe("From worktree");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips projectRootPath lookup when it equals worktreePath", async () => {
    // Both same dir — only one lookup should happen, no error
    writePromptFile("opsx-apply", "Body");
    const result = await resolveSlashReference("/opsx-apply", tmpDir, tmpDir);
    expect(result).toBe("Body");
  });

  it("resolves from personal scope when worktree and project both miss", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-"));
    try {
      const homePromptDir = join(homeDir, ".github", "prompts");
      mkdirSync(homePromptDir, { recursive: true });
      writeFileSync(join(homePromptDir, "user-cmd.prompt.md"), "From user home", "utf-8");

      const result = await resolveSlashReference("/user-cmd", tmpDir, undefined, homeDir);
      expect(result).toBe("From user home");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("personal scope has lower priority than worktree", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-"));
    try {
      const homePromptDir = join(homeDir, ".github", "prompts");
      mkdirSync(homePromptDir, { recursive: true });
      writeFileSync(join(homePromptDir, "shared.prompt.md"), "From home", "utf-8");
      writePromptFile("shared", "From worktree");

      const result = await resolveSlashReference("/shared", tmpDir, undefined, homeDir);
      expect(result).toBe("From worktree");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("personal scope has lower priority than project root", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-project-"));
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-"));
    try {
      const projectPromptDir = join(projectDir, ".github", "prompts");
      mkdirSync(projectPromptDir, { recursive: true });
      writeFileSync(join(projectPromptDir, "shared.prompt.md"), "From project", "utf-8");

      const homePromptDir = join(homeDir, ".github", "prompts");
      mkdirSync(homePromptDir, { recursive: true });
      writeFileSync(join(homePromptDir, "shared.prompt.md"), "From home", "utf-8");

      const result = await resolveSlashReference("/shared", tmpDir, projectDir, homeDir);
      expect(result).toBe("From project");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("throws when all scopes (worktree, project, personal) miss", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "railyn-home-")); // empty — no files
    try {
      await expect(
        resolveSlashReference("/zzz-totally-nonexistent-8f3k2p", tmpDir, undefined, homeDir),
      ).rejects.toThrow("could not be resolved");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
