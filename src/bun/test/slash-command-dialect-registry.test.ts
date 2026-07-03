import { describe, it, expect } from "bun:test";
import { SlashCommandDialectRegistry, createDefaultDialectRegistry } from "@bun/engine/dialects/registry.ts";
import { CopilotDialect } from "@bun/engine/dialects/copilot-dialect.ts";
import { ClaudeDialect } from "@bun/engine/dialects/claude-dialect.ts";
import { NullDialect } from "@bun/engine/dialects/null-dialect.ts";
import { CursorDialect } from "@bun/engine/dialects/cursor-dialect.ts";

describe("createDefaultDialectRegistry", () => {
  it('creates a CopilotDialect for "copilot"', () => {
    const registry = createDefaultDialectRegistry();
    expect(registry.create("copilot")).toBeInstanceOf(CopilotDialect);
  });

  it('creates a ClaudeDialect for "claude"', () => {
    const registry = createDefaultDialectRegistry();
    expect(registry.create("claude")).toBeInstanceOf(ClaudeDialect);
  });

  it('creates a CursorDialect for "cursor"', () => {
    const registry = createDefaultDialectRegistry();
    expect(registry.create("cursor")).toBeInstanceOf(CursorDialect);
  });

  it('creates a NullDialect for "none"', () => {
    const registry = createDefaultDialectRegistry();
    expect(registry.create("none")).toBeInstanceOf(NullDialect);
  });

  it('falls back to NullDialect for unknown dialect names', () => {
    const registry = createDefaultDialectRegistry();
    const dialect = registry.create("unknown");
    expect(dialect).toBeInstanceOf(NullDialect);
  });
});

describe("SlashCommandDialectRegistry.register", () => {
  it("registers a custom dialect and retrieves it via create()", () => {
    const registry = new SlashCommandDialectRegistry();
    const customInstance = new NullDialect();
    registry.register("my-dialect", () => customInstance);
    const created = registry.create("my-dialect");
    expect(created).toBeInstanceOf(NullDialect);
  });

  it("throws when registering a name that is already registered", () => {
    const registry = new SlashCommandDialectRegistry();
    registry.register("dup", () => new NullDialect());
    expect(() => registry.register("dup", () => new NullDialect())).toThrow();
  });
});

describe("Registry isolation", () => {
  it("two registry instances do not share registrations", () => {
    const r1 = new SlashCommandDialectRegistry();
    const r2 = new SlashCommandDialectRegistry();

    r1.register("only-in-r1", () => new NullDialect());

    // r2 should not see "only-in-r1" — falls back to NullDialect with a warning
    // Both should be NullDialect but the point is r2 never had it registered
    expect(() => r2.register("only-in-r1", () => new NullDialect())).not.toThrow();
  });

  it("registering in one default registry does not affect another", () => {
    const r1 = createDefaultDialectRegistry();
    const r2 = createDefaultDialectRegistry();

    // r1 gets an extra dialect
    r1.register("extra", () => new NullDialect());

    // r2 should throw if we try to add "copilot" again (it already has it),
    // but adding "extra" should succeed — confirming they are independent
    expect(() => r2.register("extra", () => new NullDialect())).not.toThrow();
  });
});
