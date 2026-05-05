import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mapAttachments } from "../engine/opencode/attachment-mapper.ts";
import type { Attachment } from "../../shared/rpc-types.ts";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "opencode-attach-test-"));
  writeFileSync(join(tmpDir, "sample.ts"), "line1\nline2\nline3\nline4\nline5\n");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function att(data: string, label = "file", mediaType = "text/plain"): Attachment {
  return { label, mediaType, data };
}

describe("mapAttachments — empty / undefined", () => {
  it("returns empty result for empty array", () => {
    const result = mapAttachments([]);
    expect(result).toEqual({ fileParts: [], extraText: "" });
  });
});

describe("mapAttachments — text attachment (base64)", () => {
  it("decodes base64 text and appends as extraText", () => {
    const encoded = Buffer.from("hello content").toString("base64");
    const result = mapAttachments([att(encoded, "note.txt", "text/plain")]);
    expect(result.fileParts).toHaveLength(0);
    expect(result.extraText).toContain("hello content");
    expect(result.extraText).toContain("note.txt");
  });
});

describe("mapAttachments — binary attachment (image)", () => {
  it("wraps binary attachment as FilePartInput data URL", () => {
    const encoded = Buffer.from([0xff, 0xd8, 0xff]).toString("base64");
    const result = mapAttachments([att(encoded, "photo.jpg", "image/jpeg")]);
    expect(result.fileParts).toHaveLength(1);
    expect(result.fileParts[0]).toMatchObject({
      type: "file",
      mime: "image/jpeg",
      filename: "photo.jpg",
    });
    expect(result.fileParts[0]!.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.extraText).toBe("");
  });
});

describe("mapAttachments — @file: reference", () => {
  it("reads file content and adds it as extraText", () => {
    const fileRef = `@file:${join(tmpDir, "sample.ts")}`;
    const result = mapAttachments([att(fileRef, "sample.ts", "text/plain")]);
    expect(result.fileParts).toHaveLength(0);
    expect(result.extraText).toContain("line1");
    expect(result.extraText).toContain("sample.ts");
  });

  it("resolves relative @file: reference against workingDirectory", () => {
    const result = mapAttachments(
      [att("@file:sample.ts", "sample.ts", "text/plain")],
      tmpDir,
    );
    expect(result.fileParts).toHaveLength(0);
    expect(result.extraText).toContain("line1");
  });

  it("skips @file: reference when file does not exist", () => {
    const result = mapAttachments([att("@file:/nonexistent/path.ts", "missing.ts", "text/plain")]);
    expect(result.fileParts).toHaveLength(0);
    expect(result.extraText).toBe("");
  });
});

describe("mapAttachments — mixed attachments", () => {
  it("handles multiple attachments of different types", () => {
    const textEncoded = Buffer.from("text content").toString("base64");
    const imageEncoded = Buffer.from([0x00]).toString("base64");
    const result = mapAttachments([
      att(textEncoded, "note.txt", "text/plain"),
      att(imageEncoded, "icon.png", "image/png"),
    ]);
    expect(result.fileParts).toHaveLength(1);
    expect(result.fileParts[0]!.mime).toBe("image/png");
    expect(result.extraText).toContain("text content");
  });
});
