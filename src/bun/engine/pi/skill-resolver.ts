import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillResolver {
  resolve(name: string): Promise<string | null>;
  list(): Promise<string[]>;
}

/** Strip matching surrounding quotes from a plain scalar value. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse the `description:` field from a skill's YAML frontmatter.
 *
 * Handles plain scalars (`description: Load skills`) and folded/block scalars
 * (`description: >-` followed by indented continuation lines, as used by the
 * `.agents/skills` skills). Returns undefined when no frontmatter or no
 * description field is present.
 */
function parseSkillDescription(content: string): string | undefined {
  const match = content.match(/^---[\r\n]([\s\S]*?)[\r\n]---/);
  if (!match) return undefined;
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed.startsWith("description:")) continue;

    const inline = trimmed.slice("description:".length).trim();
    // Plain scalar on the same line (skip folded/block scalar markers).
    if (inline && !inline.startsWith(">") && !inline.startsWith("|")) {
      return stripQuotes(inline);
    }

    // Folded/block scalar: collect subsequent indented lines until the next key.
    const parts: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "") continue;
      if (next.startsWith(" ")) {
        parts.push(next.trim());
      } else {
        break;
      }
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  return undefined;
}

/**
 * Resolves skills by scanning configured directories for `<name>/SKILL.md`.
 * Returns the content of the first match found across the provided paths.
 */
export class FileSystemSkillResolver implements SkillResolver {
  private readonly paths: string[];

  constructor(paths: string[]) {
    this.paths = paths;
  }

  async resolve(name: string): Promise<string | null> {
    for (const dir of this.paths) {
      const candidate = join(dir, name, "SKILL.md");
      if (existsSync(candidate)) {
        return readFileSync(candidate, "utf-8");
      }
    }
    return null;
  }

  async list(): Promise<string[]> {
    const skills = await this.listWithDescriptions();
    return skills.map((s) => s.name);
  }

  /**
   * List available skills (deduplicated, first path wins) together with the
   * one-line `description:` parsed from each skill's `SKILL.md` frontmatter.
   *
   * Used to build a compact `<available_skills>` index for agents without
   * inlining any skill body content.
   */
  async listWithDescriptions(): Promise<Array<{ name: string; description?: string }>> {
    const seen = new Set<string>();
    const skills: Array<{ name: string; description?: string }> = [];
    for (const dir of this.paths) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const skillMd = join(dir, entry, "SKILL.md");
        if (!existsSync(skillMd)) continue;
        seen.add(entry);
        let description: string | undefined;
        try {
          description = parseSkillDescription(readFileSync(skillMd, "utf-8"));
        } catch {
          // Unreadable SKILL.md — list the skill without a description.
        }
        skills.push(description ? { name: entry, description } : { name: entry });
      }
    }
    return skills;
  }
}
