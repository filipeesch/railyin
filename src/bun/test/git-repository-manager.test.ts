import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { GitRepositoryManager } from "../git/GitRepositoryManager.ts";

let gitDir: string;
let gitManager: GitRepositoryManager;

beforeEach(() => {
  gitDir = mkdtempSync(join(tmpdir(), "railyn-grm-"));
  gitManager = new GitRepositoryManager();

  execSync("git init -b main", { cwd: gitDir });
  execSync('git config user.email "test@test.com"', { cwd: gitDir });
  execSync('git config user.name "Test"', { cwd: gitDir });
  writeFileSync(join(gitDir, "README.md"), "initial");
  execSync("git add .", { cwd: gitDir });
  execSync('git commit -m "init"', { cwd: gitDir });
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
});

// ─── GRM-1: addWorktree ───────────────────────────────────────────────────────

describe("addWorktree", () => {
  it("creates a worktree branched from sourceBranch; worktree HEAD matches source", async () => {
    const mainSha = execSync("git rev-parse HEAD", { cwd: gitDir }).toString().trim();
    const worktreePath = mkdtempSync(join(tmpdir(), "railyn-wt-"));

    try {
      await gitManager.addWorktree(gitDir, "task-1", worktreePath, "main");

      const worktreeSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();
      expect(worktreeSha).toBe(mainSha);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }, 10_000);

  it("in 'existing' mode checks out existing branch without creating a new one", async () => {
    execSync("git checkout -b my-branch", { cwd: gitDir });
    writeFileSync(join(gitDir, "branch-file.txt"), "branch work");
    execSync("git add .", { cwd: gitDir });
    execSync('git commit -m "branch commit"', { cwd: gitDir });
    const branchSha = execSync("git rev-parse HEAD", { cwd: gitDir }).toString().trim();
    execSync("git checkout main", { cwd: gitDir, shell: "/bin/sh" });

    const worktreePath = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    try {
      await gitManager.addWorktree(gitDir, "my-branch", worktreePath, "main", "existing");

      const worktreeSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();
      expect(worktreeSha).toBe(branchSha);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }, 10_000);

  it("throws when gitRootPath does not exist", async () => {
    await expect(
      gitManager.addWorktree("/nonexistent/path", "task-1", "/tmp/wt", "main"),
    ).rejects.toThrow();
  });
});

// ─── GRM-2: listBranches ─────────────────────────────────────────────────────

describe("listBranches", () => {
  it("returns branch names, excluding entries containing HEAD", async () => {
    execSync("git checkout -b feature-a", { cwd: gitDir });
    execSync("git checkout -b feature-b", { cwd: gitDir });

    const branches = await gitManager.listBranches(gitDir);

    expect(branches).toContain("feature-a");
    expect(branches).toContain("feature-b");
    expect(branches.some((b) => b.includes("HEAD"))).toBe(false);
  });

  it("returns empty array for a non-existent directory", async () => {
    const branches = await gitManager.listBranches("/nonexistent/path");
    expect(branches).toEqual([]);
  });
});

// ─── GRM-3: revParseHead ─────────────────────────────────────────────────────

describe("revParseHead", () => {
  it("returns a 40-character SHA matching HEAD commit", async () => {
    const expectedSha = execSync("git rev-parse HEAD", { cwd: gitDir }).toString().trim();

    const sha = await gitManager.revParseHead(gitDir);

    expect(sha).toBe(expectedSha);
    expect(sha!.length).toBe(40);
  });

  it("returns null for a non-existent path", async () => {
    const sha = await gitManager.revParseHead("/nonexistent/path");
    expect(sha).toBeNull();
  });
});

// ─── GRM-4: removeWorktree ───────────────────────────────────────────────────

describe("removeWorktree", () => {
  it("removes the worktree from the git graph", async () => {
    const worktreePath = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    try {
      await gitManager.addWorktree(gitDir, "task-remove", worktreePath, "main");

      // Worktree should be listed
      const beforeList = execSync("git worktree list", { cwd: gitDir }).toString();
      expect(beforeList).toContain("task-remove");

      await gitManager.removeWorktree(gitDir, worktreePath);

      // After removal, the branch worktree entry should be gone
      const afterList = execSync("git worktree list", { cwd: gitDir }).toString();
      expect(afterList).not.toContain(worktreePath);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  }, 10_000);
});
