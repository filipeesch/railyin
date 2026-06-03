import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { SkillResolver } from "../skill-resolver.ts";

const skillParams = Type.Object({
  name: Type.String({
    description: "The name of the skill to load, exactly as it appears in <available_skills>.",
  }),
});

export function buildSkillTool(resolver: SkillResolver): AgentTool<typeof skillParams> {
  return {
    name: "skill",
    label: "Load Skill",
    description: `Load a skill's instructions by name.
Use this when the task matches a skill listed in <available_skills>.
The name must exactly match the <name> field from the available skills list.`,
    parameters: skillParams,
    execute: async (_toolCallId, args) => {
      const content = await resolver.resolve(args.name);
      if (content === null) {
        const available = await resolver.list();
        const errorParts: string[] = [];
        if (available.length === 0) {
          errorParts.push(`Skill '${args.name}' not found. No skills are currently available.`);
        } else {
          const lowerQuery = args.name.toLowerCase();
          const fuzzyMatch = available.find((n) => n.toLowerCase() === lowerQuery);
          if (fuzzyMatch) {
            errorParts.push(`Skill '${args.name}' not found. Did you mean: \`${fuzzyMatch}\`?`);
          } else {
            errorParts.push(`Skill '${args.name}' not found.`);
          }
          errorParts.push(`Available skills: ${available.map((n) => `\`${n}\``).join(", ")}`);
        }
        return {
          content: [{ type: "text", text: errorParts.join(" ") }],
          details: { name: args.name },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: content }],
        details: { name: args.name },
      };
    },
  };
}
