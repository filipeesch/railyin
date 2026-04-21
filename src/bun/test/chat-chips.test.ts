import { describe, it, expect } from "bun:test";
import { parseChips, extractChips, CHIP_PATTERN } from "../../mainview/utils/chat-chips";

describe("CHIP_PATTERN", () => {
  it("matches a file chip", () => {
    CHIP_PATTERN.lastIndex = 0;
    const m = CHIP_PATTERN.exec("[#src/app.ts|app.ts]");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("#src/app.ts");
    expect(m![2]).toBe("app.ts");
  });

  it("matches a symbol chip with line range", () => {
    CHIP_PATTERN.lastIndex = 0;
    const m = CHIP_PATTERN.exec("[#src/service.ts:L10-L25|MyService]");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("#src/service.ts:L10-L25");
    expect(m![2]).toBe("MyService");
  });

  it("matches an @ tool chip", () => {
    CHIP_PATTERN.lastIndex = 0;
    const m = CHIP_PATTERN.exec("[@fs-server:read_file|read_file]");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("@fs-server:read_file");
    expect(m![2]).toBe("read_file");
  });

  it("does not match plain text", () => {
    CHIP_PATTERN.lastIndex = 0;
    expect(CHIP_PATTERN.exec("hello world")).toBeNull();
  });
});

describe("parseChips", () => {
  it("returns empty for plain text", () => {
    expect(parseChips("hello world")).toEqual([]);
  });

  it("parses multiple chips from a doc", () => {
    const doc = "check [#src/a.ts|a.ts] and [@mcp:tool|tool] please";
    const chips = parseChips(doc);
    expect(chips).toHaveLength(2);
    expect(chips[0].ref).toBe("#src/a.ts");
    expect(chips[0].label).toBe("a.ts");
    expect(chips[1].ref).toBe("@mcp:tool");
    expect(chips[1].label).toBe("tool");
  });

  it("captures the full raw token including brackets", () => {
    const raw = "[#src/foo.ts|foo.ts]";
    const chips = parseChips(raw);
    expect(chips[0].raw).toBe(raw);
  });
});

describe("extractChips", () => {
  it("passes through plain text unchanged", () => {
    const { humanText, attachments } = extractChips("hello world");
    expect(humanText).toBe("hello world");
    expect(attachments).toEqual([]);
  });

  it("strips file chip and produces an attachment", () => {
    const { humanText, attachments } = extractChips("see [#src/app.ts|app.ts] for details");
    expect(humanText).toBe("see app.ts for details");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].data).toBe("@file:src/app.ts");
    expect(attachments[0].label).toBe("app.ts");
    expect(attachments[0].mediaType).toBe("text/plain");
  });

  it("preserves line range in symbol chip attachment data (9.3)", () => {
    const { humanText, attachments } = extractChips("[#src/svc.ts:L10-L25|MyService] is here");
    expect(humanText).toBe("MyService is here");
    expect(attachments[0].data).toBe("@file:src/svc.ts:L10-L25");
    expect(attachments[0].label).toBe("MyService");
  });

  it("@ chips produce no attachment — label replaces chip in text", () => {
    const { humanText, attachments } = extractChips("use [@mcp:tool|read_file]");
    expect(humanText).toBe("use read_file");
    expect(attachments).toHaveLength(0);
  });

  it("handles multiple chips of mixed types", () => {
    const doc = "review [#src/a.ts|a.ts] with [@mcp:t|tool] and [#src/b.ts|b.ts]";
    const { humanText, attachments } = extractChips(doc);
    expect(humanText).toBe("review a.ts with tool and b.ts");
    expect(attachments).toHaveLength(2);
    expect(attachments[0].data).toBe("@file:src/a.ts");
    expect(attachments[1].data).toBe("@file:src/b.ts");
  });

  it("trims whitespace from resulting humanText", () => {
    const { humanText } = extractChips("  [#src/a.ts|a.ts]  ");
    expect(humanText).toBe("a.ts");
  });

  it("plain text with no chips returns no attachments", () => {
    const { humanText, attachments } = extractChips("/opsx-propose my-feature");
    expect(humanText).toBe("/opsx-propose my-feature");
    expect(attachments).toEqual([]);
  });

  it("empty string returns empty", () => {
    const { humanText, attachments } = extractChips("");
    expect(humanText).toBe("");
    expect(attachments).toEqual([]);
  });
});
