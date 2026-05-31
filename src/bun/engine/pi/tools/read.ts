import { resolve, relative, isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safePath(
  worktreePath: string,
  inputPath: string,
): { safe: true; abs: string; rel: string } | { safe: false; error: string } {
  const abs = isAbsolute(inputPath) ? inputPath : join(worktreePath, inputPath);
  const resolved = resolve(abs);
  if (!resolved.startsWith(worktreePath + "/") && resolved !== worktreePath) {
    return {
      safe: false,
      error: "Error: path traversal detected — path must be inside the worktree",
    };
  }
  return { safe: true, abs: resolved, rel: relative(worktreePath, resolved) };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// File discovery is handled by the Pi SDK's built-in `find` tool (gitignore-aware, uses fd).
export function buildReadTools(): [] {
  return [];
}

