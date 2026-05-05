import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setupTestConfig } from "./helpers.ts";
import { ProjectResolver } from "../git/ProjectResolver.ts";

let configCleanup: (() => void) | null = null;

afterEach(() => {
  configCleanup?.();
  configCleanup = null;
});

// ─── PR-1: getDefaultBranch ───────────────────────────────────────────────────

describe("getDefaultBranch", () => {
  it("returns configured default_branch value from workspace YAML", () => {
    // setupTestConfig already sets default_branch: main for test-project
    const { cleanup } = setupTestConfig();
    configCleanup = cleanup;

    const resolver = new ProjectResolver();
    const result = resolver.getDefaultBranch("test", "test-project");

    expect(result).toBe("main");
  });

  it("returns 'main' when project key is not found (fallback)", () => {
    const { cleanup } = setupTestConfig();
    configCleanup = cleanup;

    const resolver = new ProjectResolver();
    const result = resolver.getDefaultBranch("test", "nonexistent-project-key");

    expect(result).toBe("main");
  });
});

// ─── PR-2: getWorktreeBasePath ────────────────────────────────────────────────

describe("getWorktreeBasePath", () => {
  it("returns configured worktree_base_path from workspace YAML", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));
    const { cleanup } = setupTestConfig(`worktree_base_path: "${tempDir}"`);
    configCleanup = () => {
      cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    };

    const resolver = new ProjectResolver();
    const result = resolver.getWorktreeBasePath("test", "test-project", "/git/root");

    expect(result).toBe(tempDir);
  });

  it("falls back to ${gitRootPath}/../worktrees when worktree_base_path is not configured", () => {
    const { cleanup } = setupTestConfig();
    configCleanup = cleanup;

    const resolver = new ProjectResolver();
    const result = resolver.getWorktreeBasePath("test", "test-project", "/git/root");

    expect(result).toBe("/git/root/../worktrees");
  });
});
