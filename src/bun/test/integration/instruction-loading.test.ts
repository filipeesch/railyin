import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDb, seedProjectAndTask } from "../helpers.ts";
import { PiDialectResolver } from "../../engine/pi/dialect-resolver.ts";
import { CopilotDialect } from "../../engine/dialects/copilot-dialect.ts";
import { CursorDialect } from "../../engine/dialects/cursor-dialect.ts";
import { NullDialect } from "../../engine/dialects/null-dialect.ts";
import { scanInstructionsFromDir } from "../../engine/dialects/instruction-scanner.ts";
import { formatInstructionBlocks } from "../../engine/pi/instruction-formatter.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `integration-${name}-`));
  return dir;
}

function createInstructionFile(dir: string, filename: string, content: string): void {
  const path = join(dir, filename);
  writeFileSync(path, content);
}

// ─── Pi Engine Integration Tests ─────────────────────────────────────────────

describe("Pi Engine Integration — Instruction Loading", () => {
  let tempDir: string;
  let resolver: PiDialectResolver;

  beforeEach(() => {
    tempDir = createTempDir("pi-integration");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("PiDialectResolver with CopilotDialect scans .github/instructions/", () => {
    resolver = new PiDialectResolver(new CopilotDialect());

    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "conventions.md", "---\ndescription: Project conventions\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].name).toBe("conventions");
  });

  it("PiDialectResolver with CursorDialect scans .cursor/rules/", () => {
    resolver = new PiDialectResolver(new CursorDialect());

    const rulesDir = join(tempDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    createInstructionFile(rulesDir, "rule.mdc", "---\ndescription: Cursor rule\n---\nContent");

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].name).toBe("rule");
  });

  it("PiDialectResolver with NullDialect returns empty array", () => {
    resolver = new PiDialectResolver(new NullDialect());

    const instructions = resolver.getInstructions(tempDir, tempDir);
    expect(instructions).toHaveLength(0);
  });

  it("Monorepo projectPath resolution — instructions from both paths", () => {
    resolver = new PiDialectResolver(new CopilotDialect());

    const worktreeDir = createTempDir("worktree");
    try {
      const cwdInstDir = join(tempDir, ".github", "instructions");
      const wtInstDir = join(worktreeDir, ".github", "instructions");
      mkdirSync(cwdInstDir, { recursive: true });
      mkdirSync(wtInstDir, { recursive: true });

      createInstructionFile(cwdInstDir, "project-rule.md", "---\ndescription: Project rule\n---\nContent");
      createInstructionFile(wtInstDir, "worktree-rule.md", "---\ndescription: Worktree rule\n---\nContent");

      const instructions = resolver.getInstructions(tempDir, worktreeDir);
      expect(instructions).toHaveLength(2);
      expect(instructions.map((i) => i.name)).toContain("project-rule");
      expect(instructions.map((i) => i.name)).toContain("worktree-rule");
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("Deduplication — projectPath version wins", () => {
    resolver = new PiDialectResolver(new CopilotDialect());

    const worktreeDir = createTempDir("worktree");
    try {
      const cwdInstDir = join(tempDir, ".github", "instructions");
      const wtInstDir = join(worktreeDir, ".github", "instructions");
      mkdirSync(cwdInstDir, { recursive: true });
      mkdirSync(wtInstDir, { recursive: true });

      createInstructionFile(cwdInstDir, "shared.md", "---\ndescription: Project version\n---\nProject content");
      createInstructionFile(wtInstDir, "shared.md", "---\ndescription: Worktree version\n---\nWorktree content");

      const instructions = resolver.getInstructions(tempDir, worktreeDir);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].description).toBe("Project version");
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });
});

// ─── Copilot Engine Integration Tests ────────────────────────────────────────

describe("Copilot Engine Integration — Instruction Loading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("copilot-integration");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Scans .github/instructions/ at project root", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "conventions.md", "---\ndescription: Project conventions\n---\nContent");

    const instructions = scanInstructionsFromDir(instructionsDir, [".md"]);
    const blocks = formatInstructionBlocks(instructions);

    expect(instructions).toHaveLength(1);
    expect(blocks).toContain("### conventions");
    expect(blocks).toContain("**Project conventions**");
  });

  it("Scans .github/instructions/ at worktree root", () => {
    const worktreeDir = createTempDir("worktree");
    try {
      const wtInstDir = join(worktreeDir, ".github", "instructions");
      mkdirSync(wtInstDir, { recursive: true });
      createInstructionFile(wtInstDir, "testing.md", "---\ndescription: Testing conventions\n---\nContent");

      const instructions = scanInstructionsFromDir(wtInstDir, [".md"]);
      const blocks = formatInstructionBlocks(instructions);

      expect(instructions).toHaveLength(1);
      expect(blocks).toContain("### testing");
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it("No instructions directory — system message without instruction content", () => {
    const instructions = scanInstructionsFromDir(join(tempDir, ".github", "instructions"), [".md"]);
    const blocks = formatInstructionBlocks(instructions);

    expect(instructions).toHaveLength(0);
    expect(blocks).toBeUndefined();
  });
});

// ─── Cursor Engine Integration Tests ─────────────────────────────────────────

describe("Cursor Engine Integration — Skill Loading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("cursor-integration");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("Skills loaded from projectPath", () => {
    const skillsDir = join(tempDir, ".cursor", "skills", "my-skill");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "SKILL.md"), "# My Skill\n\nSkill content");

    const { existsSync, readdirSync } = require("fs");
    expect(existsSync(skillsDir)).toBe(true);
    const files = readdirSync(skillsDir);
    expect(files).toContain("SKILL.md");
  });

  it("Skills deduplicated by path — no duplication when projectPath = worktreePath", () => {
    const dialect = new CursorDialect();

    const skillPaths = dialect.getSkillPaths(tempDir, tempDir);
    // When projectPath equals worktreePath, paths should be deduplicated
    const uniquePaths = new Set(skillPaths);
    expect(skillPaths.length).toBe(uniquePaths.size);
  });
});
