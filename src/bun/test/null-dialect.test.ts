import { describe, it, expect } from "bun:test";
import { NullDialect } from "@bun/engine/dialects/null-dialect.ts";

describe("NullDialect", () => {
  const dialect = new NullDialect();
  const worktreePath = "/some/path";

  describe("resolvePrompt", () => {
    it("returns content unchanged with wasSlash: false for slash input", async () => {
      const result = await dialect.resolvePrompt("/some-command", worktreePath);
      expect(result.content).toBe("/some-command");
      expect(result.wasSlash).toBe(false);
    });

    it("returns content unchanged with wasSlash: false for plain text", async () => {
      const result = await dialect.resolvePrompt("plain text", worktreePath);
      expect(result.content).toBe("plain text");
      expect(result.wasSlash).toBe(false);
    });

    it("passes through any input without transformation", async () => {
      const inputs = ["", "hello world", "/cmd arg1 arg2", "  spaces  "];
      for (const input of inputs) {
        const result = await dialect.resolvePrompt(input, worktreePath);
        expect(result.content).toBe(input);
        expect(result.wasSlash).toBe(false);
      }
    });
  });

  describe("listCommands", () => {
    it("always returns an empty array", () => {
      expect(dialect.listCommands(worktreePath)).toEqual([]);
    });

    it("returns empty array regardless of path arguments", () => {
      expect(dialect.listCommands("/any/path", "/project/path")).toEqual([]);
      expect(dialect.listCommands("/no/project")).toEqual([]);
    });
  });
});
