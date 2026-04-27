export type HunkLines = { originalLines: string[]; modifiedLines: string[] };

/** filePath → (hunkHash → line content for original and modified sides) */
export type DiffCache = Map<string, Map<string, HunkLines>>;

/**
 * Build a per-file hunk cache by running `git diff HEAD` for each file.
 * Each hunk is keyed by SHA-256 of (filePath + originalLines + modifiedLines).
 * Files that cannot be diffed (binary, untracked, git error) get an empty inner map.
 */
export async function buildDiffCache(worktreePath: string, filePaths: string[]): Promise<DiffCache> {
  const diffCache: DiffCache = new Map();
  const { createHash } = await import("node:crypto");

  for (const filePath of filePaths) {
    const hunkLineMap = new Map<string, HunkLines>();

    if (worktreePath) {
      try {
        const proc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        const diffOut = await new Response(proc.stdout).text();

        if (diffOut.trim()) {
          const hhRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
          const lines = diffOut.split("\n");
          let i = 0;
          while (i < lines.length) {
            if (!hhRe.test(lines[i])) { i++; continue; }
            i++;
            const body: string[] = [];
            while (i < lines.length && !hhRe.test(lines[i])) { body.push(lines[i]); i++; }
            const origL = body.filter((l) => l.startsWith("-") || l.startsWith(" ")).map((l) => l.slice(1));
            const modL = body.filter((l) => l.startsWith("+") || l.startsWith(" ")).map((l) => l.slice(1));
            const hash = createHash("sha256")
              .update(filePath + "\0" + origL.join("\n") + "\0" + modL.join("\n"))
              .digest("hex");
            hunkLineMap.set(hash, { originalLines: origL, modifiedLines: modL });
          }
        }
      } catch {
        // Ignore diff parsing failures; the fallback payload still includes ranges/comments.
      }
    }

    diffCache.set(filePath, hunkLineMap);
  }

  return diffCache;
}
