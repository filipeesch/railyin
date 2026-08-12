import type { LoadedConfig } from "../../config/index.ts";
import { SlashCommandDialectRegistry, createDefaultDialectRegistry } from "../dialects/registry.ts";

/**
 * Resolves slash-command references (e.g. "/foo bar") against the target engine's
 * dialect (Copilot/.github/prompts, Cursor/.cursor/commands, Pi's configured dialect)
 * BEFORE the resolved text is joined with historyBlock/decisionsBlock/stageInstructionsBlock
 * into userContent.
 *
 * This MUST happen upstream of the join: `SlashCommandDialect.resolvePrompt()` only
 * matches a leading "/command" pattern anchored at the start of the trimmed string.
 * Resolving against the full composed userContent (as engines used to do internally)
 * silently fails to match once any block is prepended ahead of the resolved prompt/
 * on_enter_prompt tail — this was the root cause of a stage_instructions-triggered
 * slash-command regression for Copilot/Cursor/Pi.
 *
 * Engines (CopilotEngine, CursorEngine, PiEngine) no longer resolve slash commands
 * themselves — they receive `params.prompt` already resolved by the executor layer.
 *
 * The actual Claude engine (ClaudeEngine) is intentionally excluded: it never called
 * SlashCommandDialect.resolvePrompt() before this change (it relies on the Claude Code
 * SDK's own native slash-command handling of the raw chip text), so it must keep
 * receiving the unresolved tail unchanged. Pi configured with `dialect: "claude"` is a
 * different case — Pi's own dialect-resolution behavior (previously always active,
 * regardless of which of copilot/claude/none it points to) is preserved.
 */
export class SlashCommandResolver {
  constructor(private readonly registry: SlashCommandDialectRegistry = createDefaultDialectRegistry()) {}

  /**
   * Determine which dialect (if any) should resolve slash references for `engineId`,
   * mirroring the resolution behavior each engine implementation had before this change.
   * Returns `undefined` when the engine never resolved slash commands (Claude, OpenCode,
   * scripted, or an unrecognized/unconfigured engine id) — callers should pass the prompt
   * through unchanged in that case.
   */
  private dialectNameFor(config: LoadedConfig, engineId: string): string | undefined {
    const entry = config.engines.find((e) => e.id === engineId);
    if (entry) {
      switch (entry.config.type) {
        case "pi":
          // Pi always actively resolves via its configured dialect (copilot/claude/none).
          return entry.config.dialect ?? "none";
        case "copilot":
          return "copilot";
        case "cursor":
          return "cursor";
        default:
          // "claude" (native SDK-side slash handling), "opencode", "scripted", or any
          // other engine type never resolved slash commands via a SlashCommandDialect.
          return undefined;
      }
    }
    // No matching entry in config.engines (e.g. the qualified model's engineId isn't
    // declared as a config.engines entry — hardwired engines like Copilot/Cursor don't
    // strictly need one, since their dialect is fixed by engine type, not config). Fall
    // back to treating the literal engineId as the dialect name only for the hardwired
    // engines; Pi genuinely needs its config entry to know which dialect to use, so an
    // unresolvable Pi engineId conservatively resolves to no dialect.
    switch (engineId) {
      case "copilot":
        return "copilot";
      case "cursor":
        return "cursor";
      default:
        return undefined;
    }
  }

  async resolve(config: LoadedConfig, engineId: string, prompt: string, workingDirectory: string, projectPath?: string): Promise<string> {
    const dialectName = this.dialectNameFor(config, engineId);
    if (!dialectName) return prompt;
    const dialect = this.registry.create(dialectName);
    try {
      const resolved = await dialect.resolvePrompt(prompt, workingDirectory, projectPath);
      return resolved.content;
    } catch (err) {
      // Fail-soft policy: an unresolvable slash reference must not hard-fail the
      // send. The raw text reaches the agent as a literal `/command` the model
      // can still act on — matching the resilience of the Claude/OpenCode native
      // engines. Dialects keep their throwing contract; this resolver owns the
      // resilience policy for every dialect-driven engine (Copilot/Cursor/Pi).
      const trimmed = prompt.trim();
      const snippet = trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(
        `[slash-command-resolver] Slash reference could not be resolved for engine '${engineId}' (dialect '${dialectName}'); passing through unchanged: ${snippet} (${detail})`,
      );
      return prompt;
    }
  }
}
