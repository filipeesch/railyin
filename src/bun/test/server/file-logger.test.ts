import { describe, test, expect, afterEach } from "bun:test";
import { setupFileLogging } from "../../server/file-logger.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;
let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

async function waitForFile(filePath: string, contains: string, maxMs = 1000): Promise<string> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      if (content.includes(contains)) return content;
    }
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`File ${filePath} did not contain "${contains}" within ${maxMs}ms`);
}

describe("setupFileLogging", () => {
  test("FL-1: log file is created when it does not exist", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "railyn-test-"));
    const logFile = join(tmpDir, "bun.log");

    const result = setupFileLogging(tmpDir);
    restore = result.restore;

    console.log("fl1-marker");

    const content = await waitForFile(logFile, "fl1-marker");
    expect(existsSync(logFile)).toBe(true);
    expect(content).toContain("fl1-marker");
  });

  test("FL-2: existing log is rotated to bun.log.prev", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "railyn-test-"));
    const logFile = join(tmpDir, "bun.log");
    const prevFile = join(tmpDir, "bun.log.prev");

    writeFileSync(logFile, "old content");

    const result = setupFileLogging(tmpDir);
    restore = result.restore;

    // Wait for the stream to flush the startup log, confirming bun.log is live
    await waitForFile(logFile, "[railyin]");

    expect(existsSync(prevFile)).toBe(true);
    expect(readFileSync(prevFile, "utf-8")).toBe("old content");
    expect(existsSync(logFile)).toBe(true);
  });

  test("FL-3: console.log writes timestamped INFO line", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "railyn-test-"));
    const logFile = join(tmpDir, "bun.log");

    const result = setupFileLogging(tmpDir);
    restore = result.restore;

    // Wait for startup log to confirm the stream is open and the file exists
    await waitForFile(logFile, "[railyin]");

    console.log("hello");

    const content = await waitForFile(logFile, "hello");
    expect(content).toContain("INFO ");
    expect(content).toContain("hello");
  });

  test("FL-4: restore() undoes console patches", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "railyn-test-"));
    const logFile = join(tmpDir, "bun.log");

    const result = setupFileLogging(tmpDir);
    restore = result.restore;

    console.log("before");
    await waitForFile(logFile, "before");

    restore();
    restore = null;

    console.log("after");

    // Give a moment for any erroneous write to occur
    await new Promise(r => setTimeout(r, 100));

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("before");
    expect(content).not.toContain("after");
  });
});
