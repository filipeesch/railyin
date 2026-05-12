import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SkillResolver {
  resolve(name: string): Promise<string | null>;
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
}
