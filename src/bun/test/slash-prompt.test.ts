import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveSlashReference } from "../workflow/slash-prompt.ts";

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
});
