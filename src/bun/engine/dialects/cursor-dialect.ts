import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename, extname } from "path";
import type { CommandInfo } from "../types.ts";
import type { ResolvedPrompt, SlashCommandDialect } from "./slash-command-dialect.ts";

const SLASH_PATTERN = /^\/([a-zA-Z0-9_:/-]+)(?:[ \t]+([^\n\r]*))?(?:[\n\r]+([\s\S]*))?$/;

function commandNameToPath(commandName: string): string {
  return commandName.replaceAll(":", "/") + ".md";
}

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

export class CursorDialect implements SlashCommandDialect {
  listCommands(worktreePath: string, projectPath?: string): CommandInfo[] {
    const seen = new Set<string>();
    const commands: CommandInfo[] = [];

    if (projectPath) {
      collectFromDir(join(projectPath, ".cursor", "commands"), "", seen, commands);
    }

    if (!projectPath || projectPath !== worktreePath) {
      collectFromDir(join(worktreePath, ".cursor", "commands"), "", seen, commands);
    }

    return commands;
  }

  async resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt> {
    const match = SLASH_PATTERN.exec(value.trim());
    if (!match) return { content: value, wasSlash: false };

    const [, commandName, input = "", appendContent = ""] = match;
    const relPath = commandNameToPath(commandName);

    const candidateDirs: string[] = [];
    if (projectPath) {
      candidateDirs.push(join(projectPath, ".cursor", "commands"));
    }
    if (!projectPath || projectPath !== worktreePath) {
      candidateDirs.push(join(worktreePath, ".cursor", "commands"));
    }

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

  getSkillPaths(worktreePath: string, projectPath?: string): string[] {
    const candidates: string[] = [];
    if (projectPath) {
      candidates.push(join(projectPath, ".cursor", "skills"));
    }
    if (!projectPath || projectPath !== worktreePath) {
      candidates.push(join(worktreePath, ".cursor", "skills"));
    }
    return candidates.filter((p) => existsSync(p));
  }
}
