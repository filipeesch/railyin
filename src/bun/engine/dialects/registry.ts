import type { SlashCommandDialect } from "./slash-command-dialect.ts";
import { NullDialect } from "./null-dialect.ts";
import { CopilotDialect } from "./copilot-dialect.ts";
import { ClaudeDialect } from "./claude-dialect.ts";
import { CursorDialect } from "./cursor-dialect.ts";

/**
 * Registry that maps dialect names to factory functions.
 *
 * Usage:
 * ```ts
 * const registry = createDefaultDialectRegistry();
 * const dialect = registry.create("copilot"); // → CopilotDialect
 * ```
 *
 * Engines with hardwired dialects (Copilot, Claude) never use this registry;
 * it is only consulted by configurable engines like Pi.
 */
export class SlashCommandDialectRegistry {
  private readonly factories = new Map<string, () => SlashCommandDialect>();

  /**
   * Register a dialect factory under `name`.
   * Throws if the name is already registered.
   */
  register(name: string, factory: () => SlashCommandDialect): this {
    if (this.factories.has(name)) {
      throw new Error(`SlashCommandDialectRegistry: dialect '${name}' is already registered`);
    }
    this.factories.set(name, factory);
    return this;
  }

  /**
   * Create a dialect instance by name.
   * Falls back to `NullDialect` for unknown names, logging a warning.
   */
  create(name: string): SlashCommandDialect {
    const factory = this.factories.get(name);
    if (!factory) {
      console.warn(`[dialect-registry] Unknown dialect '${name}' — falling back to NullDialect`);
      return new NullDialect();
    }
    return factory();
  }
}

/**
 * Build the default registry pre-loaded with the built-in dialects:
 *   - "copilot" -> CopilotDialect (.github/prompts/*.prompt.md)
 *   - "claude"  -> ClaudeDialect  (.claude/commands/ recursive)
 *   - "cursor"  -> CursorDialect  (.cursor/commands/ recursive)
 *   - "none"    -> NullDialect    (no-op)
 */
export function createDefaultDialectRegistry(): SlashCommandDialectRegistry {
  return new SlashCommandDialectRegistry()
    .register("copilot", () => new CopilotDialect())
    .register("claude", () => new ClaudeDialect())
    .register("cursor", () => new CursorDialect())
    .register("none", () => new NullDialect());
}
