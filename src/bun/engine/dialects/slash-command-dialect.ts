import type { CommandInfo } from "../types.ts";

/**
 * The result of resolving a slash command reference.
 *
 * - `content`: What to send to the LLM. For slash commands this is the XML-wrapped
 *   resolved file body; for non-slash prompts it equals the original value.
 * - `wasSlash`: True when a slash pattern was matched and resolved.
 * - `sourceCommand`: The command stem (e.g. "opsx-propose") when `wasSlash` is true.
 * - `sourceArgs`: Trailing argument text after the command stem (may be empty string).
 */
export interface ResolvedPrompt {
  content: string;
  wasSlash: boolean;
  sourceCommand?: string;
  sourceArgs?: string;
}

/**
 * Strategy interface for slash-command discovery and resolution.
 *
 * Each dialect encapsulates one filesystem convention:
 *   - copilot: .github/prompts/*.prompt.md
 *   - claude:  .claude/commands/ recursive (subdirectory colon-namespacing)
 *   - none:    No slash commands (NullDialect)
 *
 * Lookup order for all concrete dialects:
 *   1. projectPath   - highest priority (monorepo project root)
 *   2. worktreePath  - if it differs from projectPath
 *   3. User home scope (~/<convention-dir>/)
 */
export interface SlashCommandDialect {
  /**
   * List all commands discoverable for the given paths.
   * Deduplication by command name is applied; first occurrence wins.
   *
   * @param worktreePath  Absolute path to the git worktree root.
   * @param projectPath   Optional project root (higher priority than worktree).
   */
  listCommands(worktreePath: string, projectPath?: string): CommandInfo[];

  /**
   * Resolve a prompt value, expanding any slash reference it contains.
   *
   * Non-slash values are returned as-is (`wasSlash: false`).
   * Slash commands are resolved to the file body and XML-wrapped.
   *
   * @param value         The raw prompt string (may or may not start with `/`).
   * @param worktreePath  Absolute path to the git worktree root.
   * @param projectPath   Optional project root (higher priority than worktree).
   */
  resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt>;

  /**
   * Return the list of skill directory paths that should be registered with
   * an engine's resource loader (e.g. Pi's `additionalSkillPaths`).
   *
   * Engines that support native skill loading (Pi) call this at session init
   * to make the dialect's skills discoverable in the LLM system prompt.
   *
   * Returns an empty array for dialects that don't expose skill directories.
   *
   * @param worktreePath  Absolute path to the git worktree root.
   * @param projectPath   Optional project root (higher priority than worktree).
   */
  getSkillPaths(worktreePath: string, projectPath?: string): string[];
}
