/**
 * Dialect-agnostic instruction file scanner.
 *
 * Scans directories for instruction files, parses YAML frontmatter,
 * and returns structured Instruction objects. Used by Pi, Copilot, and
 * Cursor engines to load project-specific guidelines.
 *
 * Convention mapping:
 *   - copilot: .github/instructions/*.md
 *   - cursor:  .cursor/rules/*.mdc, .cursor/rules/*.md
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename, extname, resolve } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Parsed YAML frontmatter from an instruction file. */
export interface ParsedFrontmatter {
  /** Optional description from frontmatter. */
  description?: string;
  /** Whether to inject the full file content (default: false). */
  autoApply: boolean;
}

/** A single instruction loaded from a file. */
export interface Instruction {
  /** Filename stem (e.g. "conventions" from "conventions.md"). */
  name: string;
  /** Description from frontmatter. */
  description: string;
  /** Full file content — present only when autoApply is true. */
  content?: string;
  /** Absolute path to the source file. */
  sourcePath: string;
}

/** Convention definition for a dialect. */
export interface InstructionConvention {
  /** Relative subdirectory path (e.g. ".github/instructions"). */
  subdirectory: string;
  /** File extensions to match (e.g. [".md"]). */
  extensions: string[];
}

// ─── Convention Mapping ───────────────────────────────────────────────────────

const CONVENTIONS: Record<string, InstructionConvention> = {
  copilot: { subdirectory: ".github/instructions", extensions: [".md"] },
  cursor: { subdirectory: ".cursor/rules", extensions: [".mdc", ".md"] },
};

/**
 * Get the instruction convention for a given dialect name.
 * Returns null for unknown dialects.
 *
 * @param dialect - The dialect name (e.g. "copilot", "cursor").
 * @returns The convention or null if unknown.
 */
export function getInstructionConvention(dialect: string): InstructionConvention | null {
  return CONVENTIONS[dialect] ?? null;
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from file content.
 *
 * Extracts `description` (optional string) and `autoApply` (boolean, default false).
 * Returns null when no frontmatter is found or it is malformed.
 *
 * @param content - The raw file content.
 * @returns Parsed frontmatter or null.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  // Must start with ---
  if (!content.startsWith("---")) {
    return null;
  }

  // Find closing ---
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    // No closing delimiter — malformed
    return null;
  }

  const frontmatterText = content.slice(3, endIdx).trim();

  let description: string | undefined;
  let autoApply = false;

  for (const line of frontmatterText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("description:")) {
      description = trimmed.slice("description:".length).trim();
      // Remove surrounding quotes if present
      if (
        (description.startsWith('"') && description.endsWith('"')) ||
        (description.startsWith("'") && description.endsWith("'"))
      ) {
        description = description.slice(1, -1);
      }
    } else if (trimmed.startsWith("autoApply:")) {
      const value = trimmed.slice("autoApply:".length).trim().toLowerCase();
      autoApply = value === "true" || value === "yes";
    }
  }

  return { description, autoApply };
}

/**
 * Extract the body content after frontmatter.
 * Returns the portion of the file after the closing `---`.
 *
 * @param content - The raw file content.
 * @returns Body content or empty string if no frontmatter found.
 */
function extractBody(content: string): string {
  if (!content.startsWith("---")) {
    return "";
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return "";
  }

  return content.slice(endIdx + 4).replace(/^\n/, "");
}

// ─── Directory Scanning ───────────────────────────────────────────────────────

/**
 * Scan a directory for instruction files matching the given extensions.
 *
 * Performs a flat scan (no subdirectory recursion). Files without valid
 * frontmatter are silently skipped.
 *
 * @param dir - Absolute directory path to scan.
 * @param extensions - File extensions to match (e.g. [".md"]).
 * @returns Array of Instruction objects.
 */
export function scanInstructionsFromDir(dir: string, extensions: string[]): Instruction[] {
  if (!existsSync(dir)) {
    return [];
  }

  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const instructions: Instruction[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const ext = extname(entry.name);
    if (!extensions.includes(ext)) {
      continue;
    }

    const filePath = resolve(dir, entry.name);
    const name = basename(entry.name, ext);

    let rawContent: string;
    try {
      rawContent = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const frontmatter = parseFrontmatter(rawContent);
    if (frontmatter === null) {
      // Silently skip files without frontmatter
      continue;
    }

    const instruction: Instruction = {
      name,
      description: frontmatter.description ?? "",
      sourcePath: filePath,
    };

    if (frontmatter.autoApply) {
      instruction.content = extractBody(rawContent);
    }

    instructions.push(instruction);
  }

  return instructions;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Log instruction loading as a structured JSON line.
 *
 * @param engine - Engine name (e.g. "pi", "copilot").
 * @param instructions - The loaded instructions.
 */
export function logInstructionsLoaded(engine: string, instructions: Instruction[]): void {
  if (instructions.length === 0) {
    return;
  }

  console.log(
    JSON.stringify({
      event: "instructions_loaded",
      engine,
      count: instructions.length,
      files: instructions.map((i) => i.sourcePath),
    }),
  );
}
