import { describe, expect, it } from "bun:test";
import { extractWrittenFilesFromResult } from "../engine/claude/tools.ts";

describe("Claude tools writtenFiles extraction", () => {
  it("returns undefined for invalid JSON", () => {
    expect(extractWrittenFilesFromResult("not-json")).toBeUndefined();
  });

  it("returns undefined when writtenFiles is missing or not an array", () => {
    expect(extractWrittenFilesFromResult(JSON.stringify({ ok: true }))).toBeUndefined();
    expect(extractWrittenFilesFromResult(JSON.stringify({ writtenFiles: {} }))).toBeUndefined();
  });

  it("filters invalid entries and keeps only object entries with string path", () => {
    const payload = {
      writtenFiles: [
        null,
        1,
        {},
        { path: 42, operation: "patch_file", added: 0, removed: 0 },
        { path: "src/valid.ts", operation: "patch_file", added: 1, removed: 1 },
      ],
    };

    expect(extractWrittenFilesFromResult(JSON.stringify(payload))).toEqual([
      { path: "src/valid.ts", operation: "patch_file", added: 1, removed: 1 },
    ]);
  });

  it("preserves richer valid entries like rename metadata", () => {
    const payload = {
      writtenFiles: [
        {
          operation: "rename_file",
          path: "src/old.ts",
          to_path: "src/new.ts",
          added: 0,
          removed: 0,
        },
      ],
    };

    expect(extractWrittenFilesFromResult(JSON.stringify(payload))).toEqual(payload.writtenFiles);
  });
});
