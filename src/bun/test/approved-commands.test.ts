import { describe, it, expect } from "vitest";
import { parseShellBinaries } from "../engine/approved-commands.ts";

describe("parseShellBinaries", () => {
    it("returns empty array for empty string", () => {
        expect(parseShellBinaries("")).toEqual([]);
    });

    it("returns single binary for simple command", () => {
        expect(parseShellBinaries("git status")).toEqual(["git"]);
    });

    it("handles && chaining", () => {
        expect(parseShellBinaries("git status && bun test")).toEqual(["git", "bun"]);
    });

    it("handles || chaining", () => {
        expect(parseShellBinaries("git status || bun test")).toEqual(["git", "bun"]);
    });

    it("includes pipe receiver (inclusive pipe semantics)", () => {
        expect(parseShellBinaries("bun test | cat")).toEqual(["bun", "cat"]);
    });

    it("handles semicolon separator", () => {
        expect(parseShellBinaries("git commit; bun test")).toEqual(["git", "bun"]);
    });
});
