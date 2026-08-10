import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { scanInstructionsFromDir, logInstructionsLoaded } from "../engine/dialects/instruction-scanner.ts";
import { formatInstructionBlocks } from "../engine/pi/instruction-formatter.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `copilot-instruction-${name}-`));
  return dir;
}

function createInstructionFile(dir: string, filename: string, content: string): void {
  const path = join(dir, filename);
  writeFileSync(path, content);
}

// ─── Copilot Engine Instruction Scanning Tests ───────────────────────────────

describe("CopilotEngine instruction scanning — scanInstructionsFromDir", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("scan");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("scans .github/instructions/ for .md files", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "conventions.md", "---\ndescription: Project conventions\n---\nContent");

    const instructions = scanInstructionsFromDir(instructionsDir, [".md"]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].name).toBe("conventions");
    expect(instructions[0].description).toBe("Project conventions");
  });

  it("skips files without frontmatter", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "no-frontmatter.md", "Plain text content");

    const instructions = scanInstructionsFromDir(instructionsDir, [".md"]);
    expect(instructions).toHaveLength(0);
  });

  it("includes full content when autoApply is true", () => {
    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "auto-apply.md", "---\nautoApply: true\n---\nFull content here");

    const instructions = scanInstructionsFromDir(instructionsDir, [".md"]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].content).toBe("Full content here");
  });

  it("returns empty array for non-existent directory", () => {
    const instructions = scanInstructionsFromDir("/non/existent/path", [".md"]);
    expect(instructions).toHaveLength(0);
  });
});

// ─── Copilot Engine Instruction Formatting Tests ─────────────────────────────

describe("CopilotEngine instruction formatting — formatInstructionBlocks", () => {
  it("formats instruction blocks as markdown", () => {
    const instructions = [
      {
        name: "conventions",
        description: "Project conventions",
        sourcePath: "/path/to/conventions.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe("### conventions\n\n**Project conventions**");
  });

  it("formats instruction blocks with content", () => {
    const instructions = [
      {
        name: "auto-rule",
        description: "Auto apply rule",
        content: "Full content here",
        sourcePath: "/path/to/auto-rule.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe("### auto-rule\n\n**Auto apply rule**\n\nFull content here");
  });

  it("returns undefined for empty array", () => {
    expect(formatInstructionBlocks([])).toBeUndefined();
  });
});

// ─── Copilot Engine System Message Construction Tests ────────────────────────

describe("CopilotEngine system message construction", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("system-msg");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("instruction blocks are appended to systemContent", () => {
    const taskBlock = "## Task\n**Title:** Test Task";
    const systemInstructions = "System instructions here";

    const instructionsDir = join(tempDir, ".github", "instructions");
    mkdirSync(instructionsDir, { recursive: true });
    createInstructionFile(instructionsDir, "conventions.md", "---\ndescription: Project conventions\n---\nContent");

    const instructions = scanInstructionsFromDir(instructionsDir, [".md"]);
    const instructionBlocks = formatInstructionBlocks(instructions);

    const systemContent = [taskBlock, instructionBlocks, systemInstructions].filter(Boolean).join("\n\n");

    expect(systemContent).toContain(taskBlock);
    expect(systemContent).toContain(instructionBlocks!);
    expect(systemContent).toContain(systemInstructions);
  });

  it("systemContent constructed without instructions when none found", () => {
    const taskBlock = "## Task\n**Title:** Test Task";
    const systemInstructions = "System instructions here";

    const instructions = scanInstructionsFromDir(join(tempDir, ".github", "instructions"), [".md"]);
    const instructionBlocks = formatInstructionBlocks(instructions);

    const systemContent = [taskBlock, instructionBlocks, systemInstructions].filter(Boolean).join("\n\n");

    expect(systemContent).toBe(`${taskBlock}\n\n${systemInstructions}`);
  });

  it("deduplication by name works correctly", () => {
    const projectPath = createTempDir("project");
    const worktreePath = createTempDir("worktree");

    try {
      const projInstDir = join(projectPath, ".github", "instructions");
      const wtInstDir = join(worktreePath, ".github", "instructions");
      mkdirSync(projInstDir, { recursive: true });
      mkdirSync(wtInstDir, { recursive: true });

      createInstructionFile(projInstDir, "shared.md", "---\ndescription: Project version\n---\nProject content");
      createInstructionFile(wtInstDir, "shared.md", "---\ndescription: Worktree version\n---\nWorktree content");
      createInstructionFile(wtInstDir, "worktree-only.md", "---\ndescription: Worktree only\n---\nWT content");

      const seen = new Set<string>();
      const instructions: import("../engine/dialects/instruction-scanner.ts").Instruction[] = [];

      // Scan projectPath first (higher priority)
      for (const inst of scanInstructionsFromDir(projInstDir, [".md"])) {
        if (!seen.has(inst.name)) {
          seen.add(inst.name);
          instructions.push(inst);
        }
      }

      // Scan worktreePath
      for (const inst of scanInstructionsFromDir(wtInstDir, [".md"])) {
        if (!seen.has(inst.name)) {
          seen.add(inst.name);
          instructions.push(inst);
        }
      }

      expect(instructions).toHaveLength(2);
      expect(instructions.find((i) => i.name === "shared")?.description).toBe("Project version");
      expect(instructions.find((i) => i.name === "worktree-only")?.description).toBe("Worktree only");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

// ─── Copilot Engine Logging Tests ────────────────────────────────────────────

describe("CopilotEngine instruction logging", () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => logs.push(args[0] as string);
  });

  afterEach(() => {
    console.log = () => {};
  });

  it("emits JSON log when instructions are loaded", () => {
    logInstructionsLoaded("copilot", [
      {
        name: "rule",
        description: "Rule",
        sourcePath: "/path/to/rule.md",
      },
    ]);

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.event).toBe("instructions_loaded");
    expect(parsed.engine).toBe("copilot");
    expect(parsed.count).toBe(1);
  });

  it("does not log when no instructions found", () => {
    logInstructionsLoaded("copilot", []);
    expect(logs).toHaveLength(0);
  });
});
