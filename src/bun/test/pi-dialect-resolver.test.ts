import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { PiDialectResolver } from "../engine/pi/dialect-resolver.ts";
import { CopilotDialect } from "../engine/dialects/copilot-dialect.ts";
import { CursorDialect } from "../engine/dialects/cursor-dialect.ts";
import { NullDialect } from "../engine/dialects/null-dialect.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-dialect-${name}-`));
  return dir;
}

function createInstructionFile(dir: string, filename: string, content: string): void {
  const path = join(dir, filename);
  writeFileSync(path, content);
}

// ─── Copilot Dialect Tests ───────────────────────────────────────────────────

describe("PiDialectResolver.getInstructions() — Copilot", () => {
  let tempDir: string;
  let resolver: PiDialectResolver;

  beforeEach(() => {
    tempDir = createTempDir("copilot");
    resolver = new PiDialectResolver(new CopilotDialect());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scans .github/instructions/ for .md files", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "conventions.md", "---\ndescription: Project conventions\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].name).toBe("conventions");
    expect(instructions[0].description).toBe("Project conventions");
  });

  it("returns empty array when no instruction directory exists", () => {
    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(0);
  });

  it("skips files without frontmatter", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "no-frontmatter.md", "Plain text content");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(0);
  });

  it("includes full content when autoApply is true", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "auto-apply.md", "---\nautoApply: true\n---\nFull content here");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].content).toBe("Full content here");
  });

  it("deduplicates by name when cwd and worktree are same", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "rule.md", "---\ndescription: Rule\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
  });

  it("scans both cwd and worktree when different", () => {
    const worktreeDir = createTempDir("worktree");
    try {
      const cwdInstDir = join(tempDir, ".github", "instructions");
      const wtInstDir = join(worktreeDir, ".github", "instructions");
      mkdirSync(cwdInstDir, { recursive: true });
      mkdirSync(wtInstDir, { recursive: true });

      createInstructionFile(cwdInstDir, "cwd-rule.md", "---\ndescription: CWD rule\n---\nContent");
      createInstructionFile(wtInstDir, "wt-rule.md", "---\ndescription: WT rule\n---\nContent");

      const instructions = resolver.getInstructions(tempDir, worktreeDir);
      expect(instructions).toHaveLength(2);
      expect(instructions.map((i) => i.name)).toContain("cwd-rule");
      expect(instructions.map((i) => i.name)).toContain("wt-rule");
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("cwd files have priority over worktree files (deduplication)", () => {
    const worktreeDir = createTempDir("worktree");
    try {
      const cwdInstDir = join(tempDir, ".github", "instructions");
      const wtInstDir = join(worktreeDir, ".github", "instructions");
      mkdirSync(cwdInstDir, { recursive: true });
      mkdirSync(wtInstDir, { recursive: true });

      createInstructionFile(cwdInstDir, "shared.md", "---\ndescription: CWD version\n---\nCWD content");
      createInstructionFile(wtInstDir, "shared.md", "---\ndescription: WT version\n---\nWT content");

      const instructions = resolver.getInstructions(tempDir, worktreeDir);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].description).toBe("CWD version");
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });
});

// ─── Cursor Dialect Tests ────────────────────────────────────────────────────

describe("PiDialectResolver.getInstructions() — Cursor", () => {
  let tempDir: string;
  let resolver: PiDialectResolver;

  beforeEach(() => {
    tempDir = createTempDir("cursor");
    resolver = new PiDialectResolver(new CursorDialect());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scans .cursor/rules/ for .mdc files", () => {
    const rulesDir = join(tempDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    createInstructionFile(rulesDir, "rule.mdc", "---\ndescription: Cursor rule\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].name).toBe("rule");
  });

  it("scans .cursor/rules/ for .md files", () => {
    const rulesDir = join(tempDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    createInstructionFile(rulesDir, "rule.md", "---\ndescription: Cursor rule\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
  });

  it("scans both .mdc and .md extensions", () => {
    const rulesDir = join(tempDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    createInstructionFile(rulesDir, "rule1.mdc", "---\ndescription: Rule 1\n---\nContent");
    createInstructionFile(rulesDir, "rule2.md", "---\ndescription: Rule 2\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(2);
  });
});

// ─── Null Dialect Tests ──────────────────────────────────────────────────────

describe("PiDialectResolver.getInstructions() — NullDialect", () => {
  let tempDir: string;
  let resolver: PiDialectResolver;

  beforeEach(() => {
    tempDir = createTempDir("null");
    resolver = new PiDialectResolver(new NullDialect());
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty array for NullDialect", () => {
    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(0);
  });

  it("does not throw when no instruction directory exists", () => {
    expect(() => resolver.getInstructions(tempDir, tempDir)).not.toThrow();
  });
});

// ─── Logging Tests ───────────────────────────────────────────────────────────

describe("PiDialectResolver.getInstructions() — Logging", () => {
  let tempDir: string;
  let resolver: PiDialectResolver;
  let logs: string[];

  beforeEach(() => {
    tempDir = createTempDir("logging");
    resolver = new PiDialectResolver(new CopilotDialect());
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args[0] as string);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    console.log = () => {};
  });

  it("emits JSON log when instructions are loaded", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "rule.md", "---\ndescription: Rule\n---\nContent");

    resolver.getInstructions(tempDir, tempDir);

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.event).toBe("instructions_loaded");
    expect(parsed.engine).toBe("pi");
    expect(parsed.count).toBe(1);
  });

  it("does not log when no instructions found", () => {
    resolver.getInstructions(tempDir, tempDir);
    expect(logs).toHaveLength(0);
  });
});
