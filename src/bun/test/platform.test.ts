import { describe, it, expect } from "bun:test";
import {
  isWindows,
  getHomeDir,
  getTmpDir,
  getDataDir,
  getPathDelimiter,
  getDefaultShell,
  getShellArgs,
  getGitFallbacks,
} from "../utils/platform.ts";

describe("platform utils", () => {
  it("isWindows returns a boolean", () => {
    expect(typeof isWindows()).toBe("boolean");
  });

  it("getHomeDir returns a non-empty string", () => {
    const dir = getHomeDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("getTmpDir returns a non-empty string", () => {
    const dir = getTmpDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("getDataDir returns a non-empty string", () => {
    const dir = getDataDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("getPathDelimiter returns : or ;", () => {
    const delim = getPathDelimiter();
    expect(["/", ":", ";"]).toContain(delim);
  });

  it("getDefaultShell returns a non-empty string", () => {
    const shell = getDefaultShell();
    expect(typeof shell).toBe("string");
    expect(shell.length).toBeGreaterThan(0);
  });

  it("getShellArgs returns a 2-element array", () => {
    const args = getShellArgs("dir");
    expect(Array.isArray(args)).toBe(true);
    expect(args.length).toBe(2);
    expect(typeof args[0]).toBe("string");
    expect(args[1]).toBe("dir");
  });

  it("getGitFallbacks returns a non-empty array of strings", () => {
    const fallbacks = getGitFallbacks();
    expect(Array.isArray(fallbacks)).toBe(true);
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const f of fallbacks) {
      expect(typeof f).toBe("string");
      expect(f.length).toBeGreaterThan(0);
    }
  });
});
