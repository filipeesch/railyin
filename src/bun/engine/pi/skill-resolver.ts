import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillResolver {
  resolve(name: string): Promise<string | null>;
  list(): Promise<string[]>;
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
    const seen = new Set<string>();
    const names: string[] = [];
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
        if (existsSync(join(dir, entry, "SKILL.md"))) {
          seen.add(entry);
          names.push(entry);
        }
      }
    }
    return names;
  }
}
