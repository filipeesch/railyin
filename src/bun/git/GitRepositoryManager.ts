import { existsSync } from "fs";
import { getConfig } from "../config/index.ts";

const FALLBACK_GIT_PATHS = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

export class GitRepositoryManager {
  private resolveGit(): string {
    // Config override takes top priority (workspace.git_path in railyn.yaml)
    try {
      const gitPath = getConfig().workspace.git_path;
      if (gitPath) return gitPath;
    } catch { /* config not loaded yet — fall through */ }

    const found = Bun.which("git", {
      PATH: [process.env.PATH, "/usr/local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"]
        .filter(Boolean)
        .join(":"),
    });
    if (found) return found;

    for (const p of FALLBACK_GIT_PATHS) {
      if (existsSync(p)) return p;
    }

    throw new Error(
      "git not found. Set workspace.git_path in railyn.yaml (e.g. git_path: /usr/bin/git)",
    );
  }

  async addWorktree(
    gitRootPath: string,
    branch: string,
    worktreePath: string,
    sourceBranch: string,
    mode: "new" | "existing" = "new",
  ): Promise<void> {
    const git = this.resolveGit();
    const args = mode === "existing"
      ? [git, "worktree", "add", worktreePath, branch]
      : [git, "worktree", "add", "-b", branch, worktreePath, sourceBranch];

    const proc = Bun.spawn(args, {
      cwd: gitRootPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git worktree add failed (exit ${exitCode}): ${stderr.trim()}`);
    }
  }

  async removeWorktree(gitRootPath: string, worktreePath: string): Promise<void> {
    const git = this.resolveGit();
    const proc = Bun.spawn(
      [git, "worktree", "remove", "--force", worktreePath],
      {
        cwd: gitRootPath,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await proc.exited;
  }

  async revParseHead(worktreePath: string): Promise<string | null> {
    const git = this.resolveGit();
    try {
      const proc = Bun.spawn([git, "rev-parse", "HEAD"], {
        cwd: worktreePath,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      if (proc.exitCode !== 0) return null;
      return (await new Response(proc.stdout).text()).trim() || null;
    } catch {
      return null;
    }
  }

  async listBranches(gitRootPath: string): Promise<string[]> {
    const git = this.resolveGit();
    try {
      const proc = Bun.spawn(
        [git, "branch", "-a", "--format=%(refname:short)"],
        {
          cwd: gitRootPath,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await proc.exited;
      if (proc.exitCode !== 0) return [];
      const output = await new Response(proc.stdout).text();
      return output
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.includes("HEAD"));
    } catch {
      return [];
    }
  }
}
