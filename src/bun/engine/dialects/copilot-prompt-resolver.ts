import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Pattern: /prompt-name optionally followed by same-line argument text,
 * then optionally a newline and additional content to append after resolution.
 * Matches the filename stem of a .github/prompts/*.prompt.md file.
 * e.g. /opsx-apply, /opsx-propose my-feature, /run-ui-tests
 *
 * A newline does NOT extend the argument — only same-line text after the stem
 * is treated as $input (matching how Copilot interprets slash commands).
 * Any content after the first newline is appended to the resolved prompt body.
 */
const SLASH_PATTERN = /^\/([a-zA-Z0-9_-]+)(?:[ \t]+([^\n\r]*))?(?:[\n\r]+([\s\S]*))?$/;

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
 * Copilot dialect prompt resolver.
 *
 * Resolves a slash reference like `/opsx-propose add-dark-mode` to the body of
 * `.github/prompts/opsx-propose.prompt.md`, with `$input` substituted by any
 * trailing argument text.
 *
 * Lookup order:
 *   1. `<worktreePath>/.github/prompts/<stem>.prompt.md`
 *   2. `<process.cwd()>/.github/prompts/<stem>.prompt.md` (railyin app repo fallback)
 *
 * - If `value` does not match the slash pattern, it is returned unchanged.
 * - If the pattern matches but no file is found in either location, an error is
 *   thrown with a descriptive message identifying the missing path.
 *
 * Used by: NativeEngine, CopilotEngine.
 * Not used by: ClaudeEngine (passes prompt raw to the SDK, which resolves
 * `.claude/commands/` and `.claude/skills/` natively in the cwd).
 */
export async function resolvePrompt(value: string, worktreePath: string): Promise<string> {
  const match = SLASH_PATTERN.exec(value.trim());
  if (!match) return value;

  const [, stem, input = "", appendContent = ""] = match;
  const fileName = `${stem}.prompt.md`;
  const filePath = join(worktreePath, ".github", "prompts", fileName);

  // Resolve path: try worktree first, then fall back to the app's own .github/prompts/
  let resolvedPath: string | null = null;
  if (existsSync(filePath)) {
    resolvedPath = filePath;
  } else {
    const fallbackPath = join(process.cwd(), ".github", "prompts", fileName);
    if (existsSync(fallbackPath)) {
      resolvedPath = fallbackPath;
    }
  }

  if (!resolvedPath) {
    // Not a slash reference — the leading / might be a path or URL fragment.
    // Only treat as an error if the stem looks like an intentional prompt name
    // (contains at least one letter and no path separators).
    if (stem.includes("/") || stem.includes("\\")) return value;
    throw new Error(
      `Slash reference '/${stem}' could not be resolved: ` +
      `file not found at ${filePath}`,
    );
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const body = stripFrontmatter(raw);
  const resolved = body.replaceAll("$input", input.trim());
  return appendContent.trim() ? `${resolved}\n\n${appendContent.trim()}` : resolved;
}
