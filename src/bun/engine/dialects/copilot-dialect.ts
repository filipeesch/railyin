import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { CommandInfo } from "../types.ts";
import type { ResolvedPrompt, SlashCommandDialect } from "./slash-command-dialect.ts";

/**
 * Slash-command pattern: `/stem [args][\nappend]`
 *
 * Matches the filename stem of a `.github/prompts/*.prompt.md` file.
 * Same-line text after the stem is the $input substitution argument.
 * Content after the first newline is appended to the resolved body.
 */
const SLASH_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:[ \t]+([^\n\r]*))?(?:[\n\r]+([\s\S]*))?$/;

/** Strip YAML frontmatter from a prompt file body. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, "");
}

/** Extract `description` value from YAML frontmatter. */
function parseFrontmatterDescription(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---[\r\n]([\s\S]*?)[\r\n]---/);
    if (!match) return undefined;
    const descLine = match[1].match(/^description:\s*(.+)$/m);
    return descLine ? descLine[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Collect all `.prompt.md` commands from a single directory (flat scan, no subdirs). */
function collectFromDir(dir: string, seen: Set<string>, out: CommandInfo[]): void {
  if (!existsSync(dir)) return;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".prompt.md")) {
      const commandName = basename(entry.name, ".prompt.md");
      if (!seen.has(commandName)) {
        seen.add(commandName);
        out.push({ name: commandName, description: parseFrontmatterDescription(join(dir, entry.name)) });
      }
    }
  }
}

/**
 * Copilot dialect — discovers and resolves slash commands using the
 * `.github/prompts/*.prompt.md` convention.
 *
 * Lookup order (highest priority first):
 *   1. `<projectPath>/.github/prompts/`   — project root
 *   2. `<worktreePath>/.github/prompts/`  — git worktree root (if different)
 *   3. `~/.github/prompts/`               — user home scope
 *   4. `<process.cwd()>/.github/prompts/` — app directory fallback
 *
 * Resolution:
 *   - `$input` is substituted with the trailing argument text on the slash line.
 *   - YAML frontmatter is stripped from the resolved body.
 *   - The resolved body is XML-wrapped with command identity:
 *     `<command name="stem" args="input">\n…body…\n</command>`
 */
export class CopilotDialect implements SlashCommandDialect {
  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    const seen = new Set<string>();
    const commands: CommandInfo[] = [];

    // projectPath is highest priority
    if (projectPath) {
      collectFromDir(join(projectPath, ".github", "prompts"), seen, commands);
    }

    // worktreePath second (if different from projectPath)
    if (!projectPath || projectPath !== worktreePath) {
      collectFromDir(join(worktreePath, ".github", "prompts"), seen, commands);
    }

    // User home scope
    collectFromDir(join(homedir(), ".github", "prompts"), seen, commands);

    return commands;
  }

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    const match = SLASH_PATTERN.exec(value.trim());
    if (!match) return { content: value, wasSlash: false };

    const [, stem, input = "", appendContent = ""] = match;
    const fileName = `${stem}.prompt.md`;

    const candidates: string[] = [];
    if (projectPath) {
      candidates.push(join(projectPath, ".github", "prompts", fileName));
    }
    if (!projectPath || projectPath !== worktreePath) {
      candidates.push(join(worktreePath, ".github", "prompts", fileName));
    }
    candidates.push(join(homedir(), ".github", "prompts", fileName));
    candidates.push(join(process.cwd(), ".github", "prompts", fileName));

    const resolvedPath = candidates.find((p) => existsSync(p)) ?? null;

    if (!resolvedPath) {
      if (stem.includes("/") || stem.includes("\\")) return { content: value, wasSlash: false };
      throw new Error(
        `Slash reference '/${stem}' could not be resolved: ` +
        `file not found at ${candidates[0]}`,
      );
    }

    const raw = readFileSync(resolvedPath, "utf-8");
    const body = stripFrontmatter(raw);
    const resolved = body.replaceAll("$input", input.trim());
    const fullBody = appendContent.trim() ? `${resolved}\n\n${appendContent.trim()}` : resolved;

    const xmlWrapped = `<command name="${stem}" args="${input.trim()}">\n${fullBody}\n</command>`;
    return {
      content: xmlWrapped,
      wasSlash: true,
      sourceCommand: stem,
      sourceArgs: input.trim(),
    };
  }

  /**
   * Return `.github/skills/` directories for Pi's `additionalSkillPaths`.
   *
   * Lookup order mirrors `listCommands`:
   *   1. `<projectPath>/.github/skills/`
   *   2. `<worktreePath>/.github/skills/` (if different from projectPath)
   *   3. `~/.github/skills/`
   *
   * Only existing directories are included to avoid Pi emitting diagnostics for
   * missing paths.
   */
  getSkillPaths(worktreePath: string, projectPath?: string): string[] {
    const candidates: string[] = [];

    if (projectPath) {
      candidates.push(join(projectPath, ".github", "skills"));
    }
    if (!projectPath || projectPath !== worktreePath) {
      candidates.push(join(worktreePath, ".github", "skills"));
    }
    candidates.push(join(homedir(), ".github", "skills"));

    return candidates.filter((p) => existsSync(p));
  }
}
