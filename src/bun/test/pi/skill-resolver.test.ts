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

describe("FileSystemSkillResolver.listWithDescriptions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "skill-resolver-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(name: string, content: string, dir = tmpDir): void {
    const skillDir = join(dir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
  }

  it("returns names with plain-scalar descriptions from frontmatter", async () => {
    writeSkill("alpha", "---\nname: alpha\ndescription: Alpha skill description\n---\nBody");
    writeSkill("beta", "---\ndescription: Beta skill description\n---\nBody");

    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.listWithDescriptions();
    expect([...result].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "alpha", description: "Alpha skill description" },
      { name: "beta", description: "Beta skill description" },
    ]);
  });

  it("parses folded scalar descriptions (description: >-)", async () => {
    writeSkill(
      "folded",
      "---\nname: folded\ndescription: >-\n  First line of description\n  second line\n---\nBody",
    );

    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.listWithDescriptions();
    expect(result).toEqual([
      { name: "folded", description: "First line of description second line" },
    ]);
  });

  it("strips surrounding quotes from plain descriptions", async () => {
    writeSkill("quoted", "---\ndescription: \"A quoted description\"\n---\nBody");

    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.listWithDescriptions();
    expect(result).toEqual([{ name: "quoted", description: "A quoted description" }]);
  });

  it("omits description when frontmatter has none", async () => {
    writeSkill("bare", "Just a body with no frontmatter");
    writeSkill("no-desc", "---\nname: no-desc\n---\nBody with frontmatter but no description");

    const resolver = new FileSystemSkillResolver([tmpDir]);
    const result = await resolver.listWithDescriptions();
    expect(result).toContainEqual({ name: "bare" });
    expect(result).toContainEqual({ name: "no-desc" });
  });

  it("deduplicates by name with first path winning", async () => {
    const dir1 = join(tmpDir, "path1");
    const dir2 = join(tmpDir, "path2");
    mkdirSync(dir1);
    mkdirSync(dir2);
    writeSkill("shared", "---\ndescription: From path1\n---\nBody", dir1);
    writeSkill("shared", "---\ndescription: From path2\n---\nBody", dir2);

    const resolver = new FileSystemSkillResolver([dir1, dir2]);
    const result = await resolver.listWithDescriptions();
    expect(result).toEqual([{ name: "shared", description: "From path1" }]);
  });

  it("skips non-existent directories and entries without SKILL.md", async () => {
    mkdirSync(join(tmpDir, "not-a-skill")); // no SKILL.md inside
    writeSkill("real", "---\ndescription: Real skill\n---\nBody");

    const resolver = new FileSystemSkillResolver([join(tmpDir, "missing"), tmpDir]);
    const result = await resolver.listWithDescriptions();
    expect(result).toEqual([{ name: "real", description: "Real skill" }]);
  });

  it("returns an empty array when no skill dirs exist", async () => {
    const resolver = new FileSystemSkillResolver([join(tmpDir, "missing")]);
    expect(await resolver.listWithDescriptions()).toEqual([]);
  });

  it("list() continues to return names only (regression)", async () => {
    writeSkill("alpha", "---\ndescription: Alpha skill description\n---\nBody");

    const resolver = new FileSystemSkillResolver([tmpDir]);
    expect(await resolver.list()).toEqual(["alpha"]);
  });
});
