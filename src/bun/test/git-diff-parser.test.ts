import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { buildDiffCache } from "../engine/git/git-diff-parser.ts";

let repoDir: string;

function git(cmd: string) {
  execSync(cmd, { cwd: repoDir, stdio: "pipe" });
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "railyn-git-diff-"));
  git("git init");
  git('git config user.email "t@t.com"');
  git('git config user.name "T"');
  writeFileSync(join(repoDir, "file.ts"), "const a = 1;\n");
  git("git add .");
  git('git commit -m "init"');
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("buildDiffCache", () => {
  it("returns a non-empty hunk map for a modified tracked file", async () => {
    writeFileSync(join(repoDir, "file.ts"), "const a = 2;\n");

    const cache = await buildDiffCache(repoDir, ["file.ts"]);

    expect(cache.has("file.ts")).toBe(true);
    expect(cache.get("file.ts")!.size).toBeGreaterThan(0);
  });

  it("returns an empty hunk map for an untracked file", async () => {
    writeFileSync(join(repoDir, "untracked.ts"), "const b = 3;\n");

    const cache = await buildDiffCache(repoDir, ["untracked.ts"]);

    expect(cache.has("untracked.ts")).toBe(true);
    expect(cache.get("untracked.ts")!.size).toBe(0);
  });

  it("returns an empty map for an empty filePaths array", async () => {
    const cache = await buildDiffCache(repoDir, []);

    expect(cache.size).toBe(0);
  });

  it("produces the same SHA-256 hash on repeated calls with identical content", async () => {
    writeFileSync(join(repoDir, "file.ts"), "const a = 42;\n");

    const cache1 = await buildDiffCache(repoDir, ["file.ts"]);
    const cache2 = await buildDiffCache(repoDir, ["file.ts"]);

    const keys1 = [...cache1.get("file.ts")!.keys()];
    const keys2 = [...cache2.get("file.ts")!.keys()];

    expect(keys1).toEqual(keys2);
  });

  it("includes original and modified lines in each hunk entry", async () => {
    writeFileSync(join(repoDir, "file.ts"), "const a = 99;\n");

    const cache = await buildDiffCache(repoDir, ["file.ts"]);
    const hunks = cache.get("file.ts")!;
    const [hunk] = hunks.values();

    expect(hunk.originalLines).toContain("const a = 1;");
    expect(hunk.modifiedLines).toContain("const a = 99;");
  });
});
