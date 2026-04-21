import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolveFileAttachments } from "../utils/resolve-file-attachments.ts";
import type { Attachment } from "../../shared/rpc-types.ts";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "resolve-files-test-"));
  await writeFile(join(tmpDir, "sample.ts"), [
    "line1",
    "line2",
    "line3",
    "line4",
    "line5",
  ].join("\n"));
  await writeFile(join(tmpDir, "hello.js"), 'console.log("hello");\n');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function att(data: string, label = "file"): Attachment {
  return { label, mediaType: "text/plain", data };
}

describe("resolveFileAttachments", () => {
  it("returns content unchanged when no attachments", async () => {
    const result = await resolveFileAttachments("hello", []);
    expect(result).toBe("hello");
  });

  it("returns content unchanged when no @file: attachments", async () => {
    const result = await resolveFileAttachments("hello", [
      { label: "img", mediaType: "image/png", data: "data:image/png;base64,abc" },
    ]);
    expect(result).toBe("hello");
  });

  it("injects file content as fenced code block", async () => {
    const path = join(tmpDir, "hello.js");
    const result = await resolveFileAttachments("look at this", [att(`@file:${path}`, "hello.js")]);
    expect(result).toContain("look at this");
    expect(result).toContain("```js");
    expect(result).toContain(`// ${path}`);
    expect(result).toContain('console.log("hello")');
    expect(result).toContain("```");
  });

  it("injects line-range snippet with range header (9.3)", async () => {
    const path = join(tmpDir, "sample.ts");
    const result = await resolveFileAttachments("check this symbol", [att(`@file:${path}:L2-L4`)]);
    expect(result).toContain("```ts");
    expect(result).toContain(`// ${path} (lines 2–4)`);
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).toContain("line4");
    expect(result).not.toContain("line1");
    expect(result).not.toContain("line5");
  });

  it("injects soft notice for missing file (9.6)", async () => {
    const path = join(tmpDir, "does-not-exist.ts");
    const result = await resolveFileAttachments("where is it", [att(`@file:${path}`)]);
    expect(result).toContain(`[File \`${path}\` not found — skipped]`);
    expect(result).toContain("where is it");
  });

  it("continues sending when file is missing (no throw)", async () => {
    const missing = join(tmpDir, "ghost.ts");
    await expect(resolveFileAttachments("msg", [att(`@file:${missing}`)])).resolves.toBeDefined();
  });

  it("handles multiple attachments — resolves all", async () => {
    const pathA = join(tmpDir, "hello.js");
    const pathB = join(tmpDir, "sample.ts");
    const missing = join(tmpDir, "nope.ts");
    const result = await resolveFileAttachments("multi", [
      att(`@file:${pathA}`, "A"),
      att(`@file:${pathB}`, "B"),
      att(`@file:${missing}`, "C"),
    ]);
    expect(result).toContain('console.log("hello")');
    expect(result).toContain("line1");
    expect(result).toContain(`[File \`${missing}\` not found — skipped]`);
  });

  it("skips non-@file: attachments", async () => {
    const result = await resolveFileAttachments("base64 attached", [
      { label: "image.png", mediaType: "image/png", data: "data:image/png;base64,abc" },
    ]);
    expect(result).toBe("base64 attached");
  });

  it("appends blocks after content with blank line separator", async () => {
    const path = join(tmpDir, "hello.js");
    const result = await resolveFileAttachments("prompt text", [att(`@file:${path}`)]);
    expect(result.startsWith("prompt text\n\n")).toBe(true);
  });

  it("truncates file content at 100 KB and appends truncation notice", async () => {
    const { join: pathJoin } = await import("path");
    const { writeFile: wf } = await import("fs/promises");
    const bigPath = pathJoin(tmpDir, "bigfile.ts");
    // Write 101 KB of content
    const bigContent = "x".repeat(101 * 1024);
    await wf(bigPath, bigContent, "utf-8");

    const result = await resolveFileAttachments("big file check", [att(`@file:${bigPath}`, "bigfile.ts")]);
    // Should contain truncation notice
    expect(result).toContain("[truncated at 100 KB]");
    // Should not contain the full 101 KB of x's (content is capped)
    const fencedContent = result.split("```")[1] ?? "";
    expect(fencedContent.length).toBeLessThan(101 * 1024);
  });
});
