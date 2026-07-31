import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { formatInstructionBlocks } from "../engine/pi/instruction-formatter.ts";
import type { Instruction } from "../engine/dialects/instruction-scanner.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `pi-instruction-${name}-`));
  return dir;
}

function createInstructionFile(dir: string, filename: string, content: string): void {
  const path = join(dir, filename);
  writeFileSync(path, content);
}

// ─── formatInstructionBlocks() Tests ─────────────────────────────────────────

describe("formatInstructionBlocks()", () => {
  it("returns undefined for empty array", () => {
    expect(formatInstructionBlocks([])).toBeUndefined();
  });

  it("formats single instruction without content", () => {
    const instructions: Instruction[] = [
      {
        name: "conventions",
        description: "Project conventions",
        sourcePath: "/path/to/conventions.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe("### conventions\n\n**Project conventions**");
  });

  it("formats single instruction with content (autoApply)", () => {
    const instructions: Instruction[] = [
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

  it("formats multiple instructions joined with double newlines", () => {
    const instructions: Instruction[] = [
      {
        name: "rule1",
        description: "Rule 1",
        sourcePath: "/path/to/rule1.md",
      },
      {
        name: "rule2",
        description: "Rule 2",
        content: "Content 2",
        sourcePath: "/path/to/rule2.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe(
      "### rule1\n\n**Rule 1**\n\n### rule2\n\n**Rule 2**\n\nContent 2",
    );
  });

  it("handles instruction with empty description", () => {
    const instructions: Instruction[] = [
      {
        name: "no-desc",
        description: "",
        sourcePath: "/path/to/no-desc.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe("### no-desc\n\n****");
  });

  it("preserves content formatting", () => {
    const instructions: Instruction[] = [
      {
        name: "formatted",
        description: "Formatted rule",
        content: "Line 1\nLine 2\n\nParagraph 2",
        sourcePath: "/path/to/formatted.md",
      },
    ];

    const result = formatInstructionBlocks(instructions);
    expect(result).toBe("### formatted\n\n**Formatted rule**\n\nLine 1\nLine 2\n\nParagraph 2");
  });
});

// ─── Integration: Instruction Injection in System Prompt ─────────────────────

describe("PiEngine instruction injection — system prompt construction", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("system-prompt");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("instruction blocks are placed between taskBlock and systemInstructions", () => {
    const taskBlock = "## Task\n**Title:** Test Task";
    const systemInstructions = "System instructions here";

    const instructions: Instruction[] = [
      {
        name: "conventions",
        description: "Project conventions",
        sourcePath: join(tempDir, "conventions.md"),
      },
    ];

    const instructionBlocks = formatInstructionBlocks(instructions);
    const enrichedSystem = [taskBlock, instructionBlocks, systemInstructions].filter(Boolean).join("\n\n");

    expect(enrichedSystem).toContain(taskBlock);
    expect(enrichedSystem).toContain(instructionBlocks!);
    expect(enrichedSystem).toContain(systemInstructions);

    // Verify order
    const taskIndex = enrichedSystem.indexOf(taskBlock);
    const instructionIndex = enrichedSystem.indexOf(instructionBlocks!);
    const systemIndex = enrichedSystem.indexOf(systemInstructions);

    expect(taskIndex).toBeLessThan(instructionIndex);
    expect(instructionIndex).toBeLessThan(systemIndex);
  });

  it("no instruction blocks added when empty", () => {
    const taskBlock = "## Task\n**Title:** Test Task";
    const systemInstructions = "System instructions here";

    const instructionBlocks = formatInstructionBlocks([]);
    const enrichedSystem = [taskBlock, instructionBlocks, systemInstructions].filter(Boolean).join("\n\n");

    expect(enrichedSystem).toBe(`${taskBlock}\n\n${systemInstructions}`);
  });

  it("instructions without taskBlock", () => {
    const systemInstructions = "System instructions here";

    const instructions: Instruction[] = [
      {
        name: "rule",
        description: "Rule",
        sourcePath: join(tempDir, "rule.md"),
      },
    ];

    const instructionBlocks = formatInstructionBlocks(instructions);
    const enrichedSystem = [instructionBlocks, systemInstructions].filter(Boolean).join("\n\n");

    expect(enrichedSystem).toContain(instructionBlocks!);
    expect(enrichedSystem).toContain(systemInstructions);
  });

  it("instructions without systemInstructions", () => {
    const taskBlock = "## Task\n**Title:** Test Task";

    const instructions: Instruction[] = [
      {
        name: "rule",
        description: "Rule",
        sourcePath: join(tempDir, "rule.md"),
      },
    ];

    const instructionBlocks = formatInstructionBlocks(instructions);
    const enrichedSystem = [taskBlock, instructionBlocks].filter(Boolean).join("\n\n");

    expect(enrichedSystem).toContain(taskBlock);
    expect(enrichedSystem).toContain(instructionBlocks!);
  });
});
