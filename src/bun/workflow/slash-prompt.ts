import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Pattern: /prompt-name optionally followed by whitespace and argument text.
 * Matches the filename stem of a .github/prompts/*.prompt.md file.
 * e.g. /opsx-apply, /opsx-propose my-feature, /run-ui-tests
 */
const SLASH_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/;

/**
 * Strips YAML frontmatter from a prompt file body.
 * Frontmatter is a `---`-delimited block at the very start of the file.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\n/, "");
}

/**
 * Resolves a slash reference like `/opsx-propose add-dark-mode` to the body of
 * `.github/prompts/opsx-propose.prompt.md` in the given worktree, with `$input`
 * substituted by any trailing argument text.
 *
 * - If `value` does not match the slash pattern, it is returned unchanged.
 * - If the pattern matches but the file is not found, an error is thrown with a
 *   descriptive message identifying the missing path.
 */
export async function resolveSlashReference(value: string, worktreePath: string): Promise<string> {
  const match = SLASH_PATTERN.exec(value.trim());
  if (!match) return value;

  const [, stem, input = ""] = match;
  const fileName = `${stem}.prompt.md`;
  const filePath = join(worktreePath, ".github", "prompts", fileName);

  if (!existsSync(filePath)) {
    // Not a slash reference — the leading / might be a path or URL fragment.
    // Only treat as an error if the stem looks like an intentional prompt name
    // (contains at least one letter and no path separators).
    if (stem.includes("/") || stem.includes("\\")) return value;
    throw new Error(
      `Slash reference '/${stem}' could not be resolved: ` +
      `file not found at ${filePath}`,
    );
  }

  const raw = readFileSync(filePath, "utf-8");
  const body = stripFrontmatter(raw);
  return body.replaceAll("$input", input.trim());
}
