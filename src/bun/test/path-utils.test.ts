import { describe, it, expect } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import {
  resolveConfigPath,
  toWorkspaceRelativePath,
  getEffectiveWorkspacePath,
  isInsideWorkspace,
} from "../config/path-utils.ts";
import type { LoadedConfig } from "../config/index.ts";

describe("resolveConfigPath", () => {
  it("resolves a relative path against the base directory", () => {
    const result = resolveConfigPath("/home/user/workspace", "packages/ui");
    expect(result).toBe("/home/user/workspace/packages/ui");
  });

  it("returns an already-absolute path unchanged", () => {
    const result = resolveConfigPath("/home/user/workspace", "/absolute/path");
    expect(result).toBe("/absolute/path");
  });

  it("handles empty relative path (resolves to base)", () => {
    const result = resolveConfigPath("/home/user/workspace", "");
    expect(result).toBe("/home/user/workspace");
  });

  it("resolves nested paths correctly", () => {
    const result = resolveConfigPath("/home/user", "projects/app");
    expect(result).toBe("/home/user/projects/app");
  });
});

describe("toWorkspaceRelativePath", () => {
  it("converts an absolute path inside the workspace to a relative path", () => {
    const result = toWorkspaceRelativePath("/home/user/workspace", "/home/user/workspace/packages/ui");
    expect(result).toBe("packages/ui");
  });

  it("returns an empty string when path equals workspace root", () => {
    const result = toWorkspaceRelativePath("/home/user/workspace", "/home/user/workspace");
    expect(result).toBe("");
  });

  it("converts a direct child correctly", () => {
    const result = toWorkspaceRelativePath("/home/user/workspace", "/home/user/workspace/myapp");
    expect(result).toBe("myapp");
  });

  it("returns a '../' path for a directory outside the workspace", () => {
    const result = toWorkspaceRelativePath("/home/user/workspace", "/home/user/other");
    expect(result).toMatch(/^\.\./);
  });
});

describe("getEffectiveWorkspacePath", () => {
  const baseConfig = {
    workspaceKey: "default",
    workspaceName: "Test",
    configDir: "/home/user/config",
    workflows: [],
    projects: [],
    providers: [],
    workspace: {},
  } as unknown as LoadedConfig;

  it("returns workspace_path when set", () => {
    const config = { ...baseConfig, workspace: { workspace_path: "/home/user/workspace" } } as unknown as LoadedConfig;
    expect(getEffectiveWorkspacePath(config)).toBe("/home/user/workspace");
  });

  it("falls back to configDir when workspace_path is not set", () => {
    const config = { ...baseConfig, workspace: {} } as unknown as LoadedConfig;
    expect(getEffectiveWorkspacePath(config)).toBe("/home/user/config");
  });

  it("falls back to configDir when workspace_path is undefined", () => {
    const config = { ...baseConfig, workspace: { workspace_path: undefined } } as unknown as LoadedConfig;
    expect(getEffectiveWorkspacePath(config)).toBe("/home/user/config");
  });
});

describe("isInsideWorkspace", () => {
  it("returns true for a path inside the workspace", () => {
    expect(isInsideWorkspace("/home/user/workspace", "/home/user/workspace/app")).toBe(true);
  });

  it("returns true for a deeply nested path", () => {
    expect(isInsideWorkspace("/home/user/workspace", "/home/user/workspace/a/b/c")).toBe(true);
  });

  it("returns false for a path that escapes via '..'", () => {
    expect(isInsideWorkspace("/home/user/workspace", "/home/user/other")).toBe(false);
  });

  it("returns false for a sibling directory", () => {
    expect(isInsideWorkspace("/home/user/workspace", "/home/user/workspace2")).toBe(false);
  });

  it("returns true for the workspace root itself (empty relative path is valid)", () => {
    // relative(x, x) === "" — not ".." — so the implementation considers the root itself as "inside"
    expect(isInsideWorkspace("/home/user/workspace", "/home/user/workspace")).toBe(true);
  });

  it("returns false for a path completely outside the workspace", () => {
    expect(isInsideWorkspace(join(tmpdir(), "workspace"), "/var/data/other")).toBe(false);
  });
});
