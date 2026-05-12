import type { SkillResolver } from "@bun/engine/pi/skill-resolver.ts";

/**
 * In-memory SkillResolver for unit tests.
 * Accepts a pre-populated map of skill name → content.
 */
export class InMemorySkillResolver implements SkillResolver {
  private readonly skills: Map<string, string>;

  constructor(skills: Map<string, string> | Record<string, string> = {}) {
    this.skills = skills instanceof Map ? skills : new Map(Object.entries(skills));
  }

  async resolve(name: string): Promise<string | null> {
    return this.skills.get(name) ?? null;
  }
}
