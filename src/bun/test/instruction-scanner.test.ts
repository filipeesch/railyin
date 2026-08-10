import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseFrontmatter,
  scanInstructionsFromDir,
  getInstructionConvention,
  logInstructionsLoaded,
  type Instruction,
} from "../engine/dialects/instruction-scanner.ts";

// ─── parseFrontmatter() ──────────────────────────────────────────────────────

describe("parseFrontmatter()", () => {
  it("returns frontmatter with description and autoApply false", () => {
    const content = "---\ndescription: My rule\nautoApply: false\n---\nRule content";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: "My rule", autoApply: false });
  });

  it("returns frontmatter with autoApply true", () => {
    const content = "---\nautoApply: true\n---\nFull rule content";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: undefined, autoApply: true });
  });

  it("returns frontmatter with both fields", () => {
    const content = "---\ndescription: Test\nautoApply: true\n---\nBody";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: "Test", autoApply: true });
  });

  it("returns null for plain text without frontmatter", () => {
    const content = "Just plain content";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns null for malformed frontmatter (no closing ---)", () => {
    const content = "---\nno closing";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns frontmatter for empty frontmatter", () => {
    const content = "---\n---\nContent";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: undefined, autoApply: false });
  });

  it("ignores unknown frontmatter fields", () => {
    const content = "---\nname: foo\ndescription: bar\n---\nContent";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: "bar", autoApply: false });
  });

  it("handles autoApply: false explicitly", () => {
    const content = "---\nautoApply: false\n---\nContent";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: undefined, autoApply: false });
  });

  it("handles autoApply: true without description", () => {
    const content = "---\nautoApply: true\n---\nContent";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: undefined, autoApply: true });
  });

  it("parses description with special characters", () => {
    const content = '---\ndescription: Test "quoted" value\n---\nContent';
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: 'Test "quoted" value', autoApply: false });
  });

  it("handles quoted description values", () => {
    const content = '---\ndescription: "My rule"\n---\nContent';
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: "My rule", autoApply: false });
  });

  it("handles single-quoted description values", () => {
    const content = "---\ndescription: 'My rule'\n---\nContent";
    const result = parseFrontmatter(content);
    expect(result).toEqual({ description: "My rule", autoApply: false });
  });
});

// ─── scanInstructionsFromDir() ───────────────────────────────────────────────

describe("scanInstructionsFromDir()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "instruction-scan-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns instructions for valid .md files", () => {
    const content = "---\ndescription: Rule 1\n---\nContent";
    writeFileSync(join(tempDir, "rule1.md"), content);
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("rule1");
    expect(result[0].description).toBe("Rule 1");
  });

  it("returns instructions for .mdc files", () => {
    const content = "---\ndescription: Rule 2\n---\nContent";
    writeFileSync(join(tempDir, "rule.mdc"), content);
    const result = scanInstructionsFromDir(tempDir, [".mdc"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("rule");
  });

  it("ignores files with wrong extensions", () => {
    writeFileSync(join(tempDir, "rule.txt"), "---\ndescription: Rule\n---\nContent");
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty directory", () => {
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for non-existent directory", () => {
    const result = scanInstructionsFromDir("/non/existent/path", [".md"]);
    expect(result).toHaveLength(0);
  });

  it("does not scan subdirectories (flat scan)", () => {
    const subDir = join(tempDir, "subdir");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "rule.md"), "---\ndescription: Rule\n---\nContent");
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(0);
  });

  it("includes full content when autoApply is true", () => {
    const content = "---\nautoApply: true\n---\nFull content here";
    writeFileSync(join(tempDir, "rule.md"), content);
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result[0].content).toBe("Full content here");
  });

  it("excludes content when autoApply is false", () => {
    const content = "---\ndescription: Rule\n---\nContent";
    writeFileSync(join(tempDir, "rule.md"), content);
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result[0].content).toBeUndefined();
  });

  it("uses filename stem as instruction name", () => {
    const content = "---\ndescription: Rule\n---\nContent";
    writeFileSync(join(tempDir, "my-conventions.md"), content);
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result[0].name).toBe("my-conventions");
  });

  it("returns absolute sourcePath", () => {
    const content = "---\ndescription: Rule\n---\nContent";
    writeFileSync(join(tempDir, "rule.md"), content);
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result[0].sourcePath).toBe(join(tempDir, "rule.md"));
  });

  it("skips files without frontmatter", () => {
    writeFileSync(join(tempDir, "no-frontmatter.md"), "Plain text content");
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(0);
  });

  it("skips files with malformed frontmatter", () => {
    writeFileSync(join(tempDir, "malformed.md"), "---\nno closing");
    const result = scanInstructionsFromDir(tempDir, [".md"]);
    expect(result).toHaveLength(0);
  });
});

// ─── getInstructionConvention() ──────────────────────────────────────────────

describe("getInstructionConvention()", () => {
  it("returns copilot convention", () => {
    const result = getInstructionConvention("copilot");
    expect(result).toEqual({ subdirectory: ".github/instructions", extensions: [".md"] });
  });

  it("returns cursor convention", () => {
    const result = getInstructionConvention("cursor");
    expect(result).toEqual({ subdirectory: ".cursor/rules", extensions: [".mdc", ".md"] });
  });

  it("returns null for unknown dialect", () => {
    expect(getInstructionConvention("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getInstructionConvention("")).toBeNull();
  });
});

// ─── Instruction interface ───────────────────────────────────────────────────

describe("Instruction interface", () => {
  it("has required fields present", () => {
    const inst: Instruction = {
      name: "test",
      description: "Test instruction",
      sourcePath: "/path/to/file.md",
    };
    expect(inst.name).toBe("test");
    expect(inst.description).toBe("Test instruction");
    expect(inst.sourcePath).toBe("/path/to/file.md");
  });

  it("has optional content field absent when autoApply is false", () => {
    const inst: Instruction = {
      name: "test",
      description: "Test",
      sourcePath: "/path/to/file.md",
    };
    expect(inst.content).toBeUndefined();
  });

  it("has content populated when autoApply is true", () => {
    const inst: Instruction = {
      name: "test",
      description: "Test",
      content: "Full content",
      sourcePath: "/path/to/file.md",
    };
    expect(inst.content).toBe("Full content");
  });
});

// ─── logInstructionsLoaded() ─────────────────────────────────────────────────

describe("logInstructionsLoaded()", () => {
  it("does not log when instructions array is empty", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(JSON.stringify(args));

    logInstructionsLoaded("pi", []);

    console.log = originalLog;
    expect(logs).toHaveLength(0);
  });

  it("logs when instructions are loaded", () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args[0] as string);

    logInstructionsLoaded("pi", [
      { name: "rule", description: "Test", sourcePath: "/path/rule.md" },
    ]);

    console.log = originalLog;
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.event).toBe("instructions_loaded");
    expect(parsed.engine).toBe("pi");
    expect(parsed.count).toBe(1);
    expect(parsed.files).toEqual(["/path/rule.md"]);
  });
});
