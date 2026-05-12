import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystemSkillResolver } from "@bun/engine/pi/skill-resolver.ts";

describe("FileSystemSkillResolver", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-resolver-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a known skill from a single path", async () => {
    const skillDir = join(tmpDir, "my-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), "# My Skill\nDo things.");

    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.resolve("my-skill");
    expect(result).toBe("# My Skill\nDo things.");
  });

  it("returns null for an unknown skill", async () => {
    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.resolve("nonexistent-skill");
    expect(result).toBeNull();
  });

  it("returns null when paths array is empty", async () => {
    const resolver = new FileSystemSkillResolver([]);
    const result = await resolver.resolve("any-skill");
    expect(result).toBeNull();
  });

  it("skips a directory that has no SKILL.md and continues to next", async () => {
    const dir1 = join(tmpDir, "path1");
    const dir2 = join(tmpDir, "path2");
    mkdirSync(dir1);
    mkdirSync(dir2);
    // dir1 has the skill dir but no SKILL.md inside
    mkdirSync(join(dir1, "my-skill"));
    // dir2 has the full skill
    mkdirSync(join(dir2, "my-skill"));
    writeFileSync(join(dir2, "my-skill", "SKILL.md"), "Content from path2");

    const resolver = new FileSystemSkillResolver([dir1, dir2]);
    const result = await resolver.resolve("my-skill");
    expect(result).toBe("Content from path2");
  });

  it("returns content from first matching path (first-path-wins)", async () => {
    const dir1 = join(tmpDir, "path1");
    const dir2 = join(tmpDir, "path2");
    mkdirSync(dir1);
    mkdirSync(dir2);
    mkdirSync(join(dir1, "shared-skill"));
    mkdirSync(join(dir2, "shared-skill"));
    writeFileSync(join(dir1, "shared-skill", "SKILL.md"), "From path1");
    writeFileSync(join(dir2, "shared-skill", "SKILL.md"), "From path2");

    const resolver = new FileSystemSkillResolver([dir1, dir2]);
    const result = await resolver.resolve("shared-skill");
    expect(result).toBe("From path1");
  });
});
