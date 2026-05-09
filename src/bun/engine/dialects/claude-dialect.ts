import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";
import type { CommandInfo } from "../types.ts";
import type { ResolvedPrompt, SlashCommandDialect } from "./slash-command-dialect.ts";

/**
 * Slash-command pattern for Claude dialect.
 *
 * Claude commands may use colon-namespacing for subdirectory commands:
 *   `/opsx:apply` → `.claude/commands/opsx/apply.md`
 *   `/gsd-execute-phase` → `.claude/commands/gsd-execute-phase.md`
 *
 * Same-line text after the command name is the $input argument.
 * Content after the first newline is appended to the resolved body.
 */
const SLASH_PATTERN = /^\/([a-zA-Z0-9_:/-]+)(?:[ \t]+([^\n\r]*))?(?:[\n\r]+([\s\S]*))?$/;

/** Convert a colon-namespaced command name to a relative file path. */
function commandNameToPath(commandName: string): string {
  return commandName.replaceAll(":", "/") + ".md";
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

/**
 * Recursively collect all `.md` commands from a directory tree.
 * Subdirectory names become colon-namespaced prefixes.
 * e.g. `commands/opsx/apply.md` → `opsx:apply`
 */
function collectFromDir(dir: string, prefix: string, seen: Set<string>, out: CommandInfo[]): void {
  if (!existsSync(dir)) return;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
      collectFromDir(fullPath, subPrefix, seen, out);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      const stem = basename(entry.name, ".md");
      const commandName = prefix ? `${prefix}:${stem}` : stem;
      if (!seen.has(commandName)) {
        seen.add(commandName);
        out.push({ name: commandName, description: parseFrontmatterDescription(fullPath) });
      }
    }
  }
}

/**
 * Claude dialect — discovers and resolves slash commands using the
 * `.claude/commands/` convention.
 *
 * Subdirectory structure is mapped to colon-namespaced command names:
 *   `commands/opsx/apply.md`  → `/opsx:apply`
 *   `commands/gsd-fast.md`    → `/gsd-fast`
 *
 * Lookup order (highest priority first):
 *   1. `<projectPath>/.claude/commands/`  — project root
 *   2. `<worktreePath>/.claude/commands/` — git worktree root (if different)
 *   3. `~/.claude/commands/`              — user home scope
 *
 * Resolution:
 *   - `$input` is substituted with the trailing argument text.
 *   - Frontmatter is NOT stripped (Claude SDK handles it natively; we preserve
 *     the raw file body so resolution matches what the SDK would produce).
 *   - The resolved body is XML-wrapped with command identity:
 *     `<command name="stem" args="input">\n…body…\n</command>`
 */
export class ClaudeDialect implements SlashCommandDialect {
  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    const seen = new Set<string>();
    const commands: CommandInfo[] = [];

    // projectPath is highest priority
    if (projectPath) {
      collectFromDir(join(projectPath, ".claude", "commands"), "", seen, commands);
    }

    // worktreePath second (if different from projectPath)
    if (!projectPath || projectPath !== worktreePath) {
      collectFromDir(join(worktreePath, ".claude", "commands"), "", seen, commands);
    }

    // User home scope
    collectFromDir(join(homedir(), ".claude", "commands"), "", seen, commands);

    return commands;
  }

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    const match = SLASH_PATTERN.exec(value.trim());
    if (!match) return { content: value, wasSlash: false };

    const [, commandName, input = "", appendContent = ""] = match;
    const relPath = commandNameToPath(commandName);

    const candidateDirs: string[] = [];
    if (projectPath) {
      candidateDirs.push(join(projectPath, ".claude", "commands"));
    }
    if (!projectPath || projectPath !== worktreePath) {
      candidateDirs.push(join(worktreePath, ".claude", "commands"));
    }
    candidateDirs.push(join(homedir(), ".claude", "commands"));

    const resolvedPath = candidateDirs.map((d) => join(d, relPath)).find((p) => existsSync(p)) ?? null;

    if (!resolvedPath) {
      throw new Error(
        `Slash reference '/${commandName}' could not be resolved: ` +
        `file not found at ${join(candidateDirs[0] ?? worktreePath, relPath)}`,
      );
    }

    const raw = readFileSync(resolvedPath, "utf-8");
    const resolved = raw.replaceAll("$input", input.trim());
    const fullBody = appendContent.trim() ? `${resolved}\n\n${appendContent.trim()}` : resolved;

    const xmlWrapped = `<command name="${commandName}" args="${input.trim()}">\n${fullBody}\n</command>`;
    return {
      content: xmlWrapped,
      wasSlash: true,
      sourceCommand: commandName,
      sourceArgs: input.trim(),
    };
  }
}
