import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { SlashCommandResolver } from "@bun/engine/execution/slash-command-resolver.ts";
import { SlashCommandDialectRegistry } from "@bun/engine/dialects/registry.ts";
import type { SlashCommandDialect } from "@bun/engine/dialects/slash-command-dialect.ts";
import type { LoadedConfig } from "@bun/config/index.ts";

/** Minimal LoadedConfig — only `engines` is read by the resolver. */
function makeConfig(engines: LoadedConfig["engines"] = []): LoadedConfig {
  return { engines } as LoadedConfig;
}

function makeRegistry(dialect: SlashCommandDialect): SlashCommandDialectRegistry {
  return new SlashCommandDialectRegistry().register("cursor", () => dialect);
}

function makeResolvingDialect(content = "resolved body"): SlashCommandDialect {
  return {
    getDialectName: () => "cursor",
    listCommands: () => [],
    resolvePrompt: async (value: string) => ({
      content: value.startsWith("/") ? `<command name="test" args="">\n${content}\n</command>` : value,
      wasSlash: value.startsWith("/"),
    }),
    getSkillPaths: () => [],
  };
}

function makeThrowingDialect(): SlashCommandDialect {
  return {
    getDialectName: () => "cursor",
    listCommands: () => [],
    resolvePrompt: async () => {
      throw new Error(
        "Slash reference '/missing-cmd' could not be resolved: file not found at /tmp/.cursor/commands/missing-cmd.md",
      );
    },
    getSkillPaths: () => [],
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("SlashCommandResolver — fail-soft policy", () => {
  it("returns the raw prompt unchanged when the dialect throws", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeThrowingDialect()));
    const result = await resolver.resolve(makeConfig(), "cursor", "/missing-cmd", "/tmp");
    expect(result).toBe("/missing-cmd");
  });

  it("logs a warning identifying engine, dialect, and prompt snippet", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeThrowingDialect()));
    await resolver.resolve(makeConfig(), "cursor", "/missing-cmd some-args", "/tmp");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]![0]);
    expect(message).toContain("engine 'cursor'");
    expect(message).toContain("dialect 'cursor'");
    expect(message).toContain("/missing-cmd some-args");
  });

  it("truncates long prompts in the warning", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeThrowingDialect()));
    const longPrompt = `/missing-cmd ${"x".repeat(300)}`;
    await resolver.resolve(makeConfig(), "cursor", longPrompt, "/tmp");

    const message = String(warnSpy.mock.calls[0]![0]);
    expect(message).toContain("…");
  });

  it("does not warn or alter the prompt when resolution succeeds", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeResolvingDialect()));
    const result = await resolver.resolve(makeConfig(), "cursor", "/test", "/tmp");
    expect(result).toBe('<command name="test" args="">\nresolved body\n</command>');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passes non-slash prompts through unchanged without warning", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeResolvingDialect()));
    const result = await resolver.resolve(makeConfig(), "cursor", "plain text", "/tmp");
    expect(result).toBe("plain text");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns the prompt unchanged for engines without a dialect (claude)", async () => {
    const resolver = new SlashCommandResolver(makeRegistry(makeThrowingDialect()));
    const result = await resolver.resolve(makeConfig(), "claude", "/some-command", "/tmp");
    expect(result).toBe("/some-command");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
