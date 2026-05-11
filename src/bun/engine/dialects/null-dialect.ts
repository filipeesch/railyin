import type { CommandInfo } from "../types.ts";
import type { ResolvedPrompt, SlashCommandDialect } from "./slash-command-dialect.ts";

/**
 * No-op dialect — used by engines that do not support slash-command resolution
 * (Claude, OpenCode) or by Pi engines where no `dialect:` is configured.
 *
 * `listCommands` always returns an empty array.
 * `resolvePrompt` returns the value unchanged with `wasSlash: false`.
 */
export class NullDialect implements SlashCommandDialect {
  listCommands(_worktreePath: string, _projectPath?: string): CommandInfo[] {
    return [];
  }

  async resolvePrompt(value: string, _worktreePath: string, _projectPath?: string): Promise<ResolvedPrompt> {
    return { content: value, wasSlash: false };
  }

  getSkillPaths(_worktreePath: string, _projectPath?: string): string[] {
    return [];
  }
}
