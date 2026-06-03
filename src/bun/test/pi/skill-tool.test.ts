import { describe, it, expect } from "vitest";
import { buildSkillTool } from "@bun/engine/pi/tools/skill.ts";
import { InMemorySkillResolver } from "./fixtures/InMemorySkillResolver.ts";

describe("buildSkillTool", () => {
  it("has name 'skill'", () => {
    const resolver = new InMemorySkillResolver();
    const tool = buildSkillTool(resolver);
    expect(tool.name).toBe("skill");
  });

  it("returns skill content when skill is found", async () => {
    const resolver = new InMemorySkillResolver({ "my-skill": "# My Skill\nInstructions here." });
    const tool = buildSkillTool(resolver);

    const result = await tool.execute("tool-call-1", { name: "my-skill" }, {} as any);
    expect((result as any).isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: "text", text: "# My Skill\nInstructions here." });
  });

  it("returns isError result when skill is not found", async () => {
    const resolver = new InMemorySkillResolver({});
    const tool = buildSkillTool(resolver);

    const result = await tool.execute("tool-call-2", { name: "missing-skill" }, {} as any);
    expect((result as any).isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("missing-skill") });
  });

  it("passes the skill name through to the resolver", async () => {
    const calls: string[] = [];
    const resolver: import("@bun/engine/pi/skill-resolver.ts").SkillResolver = {
      async resolve(name) {
        calls.push(name);
        return null;
      },
      async list() {
        return [];
      },
    };
    const tool = buildSkillTool(resolver);
    await tool.execute("tool-call-3", { name: "test-skill" }, {} as any);
    expect(calls).toEqual(["test-skill"]);
  });
});
