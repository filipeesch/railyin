import { describe, expect, it } from "vitest";
import { buildBaseOptions } from "../../engine/cursor/options.ts";

describe("buildBaseOptions", () => {
    it("always includes settingSources: ['project'] in local", () => {
        const opts = buildBaseOptions("api-key", "claude-sonnet", "/work", {});
        expect(opts.local.settingSources).toEqual(["project"]);
    });

    it("forwards apiKey to root level", () => {
        const opts = buildBaseOptions("my-key", "model-id", "/cwd", {});
        expect(opts.apiKey).toBe("my-key");
    });

    it("sets model.id when model is provided", () => {
        const opts = buildBaseOptions("key", "claude-sonnet-4-6", "/cwd", {});
        expect(opts.model).toEqual({ id: "claude-sonnet-4-6" });
    });

    it("sets model to undefined when model is falsy", () => {
        const opts = buildBaseOptions("key", undefined, "/cwd", {});
        expect(opts.model).toBeUndefined();
    });

    it("forwards workingDirectory as local.cwd", () => {
        const opts = buildBaseOptions("key", "model", "/my/working/dir", {});
        expect(opts.local.cwd).toBe("/my/working/dir");
    });

    it("forwards customTools into local.customTools", () => {
        const tools = { my_tool: { execute: () => "" } };
        const opts = buildBaseOptions("key", "model", "/cwd", tools);
        expect(opts.local.customTools).toBe(tools);
    });
});
