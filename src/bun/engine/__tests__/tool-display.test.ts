import { describe, expect, it } from "bun:test";
import { canonicalToolDisplayLabel } from "../tool-display.ts";

describe("tool display normalization", () => {
    it("normalizes read aliases", () => {
        expect(canonicalToolDisplayLabel("read")).toBe("read");
        expect(canonicalToolDisplayLabel("read_file")).toBe("read");
        expect(canonicalToolDisplayLabel("view")).toBe("read");
    });

    it("normalizes run aliases", () => {
        expect(canonicalToolDisplayLabel("bash")).toBe("run");
        expect(canonicalToolDisplayLabel("run_in_terminal")).toBe("run");
        expect(canonicalToolDisplayLabel("run")).toBe("run");
    });

    it("normalizes search aliases", () => {
        expect(canonicalToolDisplayLabel("grep")).toBe("search");
        expect(canonicalToolDisplayLabel("rg")).toBe("search");
        expect(canonicalToolDisplayLabel("grep_search")).toBe("search");
    });
});
