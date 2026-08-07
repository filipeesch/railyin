import { describe, expect, it } from "vitest";
import {
  parseCursorToken,
  parseContextWindowFromId,
  parseContextWindowFromParams,
  resolveModelContextWindow,
} from "./model-context.ts";

describe("parseCursorToken", () => {
  it("parses k / m suffixes and raw integers", () => {
    expect(parseCursorToken("300k")).toBe(300_000);
    expect(parseCursorToken("1m")).toBe(1_000_000);
    expect(parseCursorToken("272k")).toBe(272_000);
    expect(parseCursorToken("272000")).toBe(272_000);
  });

  it("is case-insensitive", () => {
    expect(parseCursorToken("300K")).toBe(300_000);
    expect(parseCursorToken("1M")).toBe(1_000_000);
  });

  it("returns NaN for non-numeric tokens like auto", () => {
    expect(parseCursorToken("auto")).toBeNaN();
    expect(parseCursorToken("")).toBeNaN();
  });
});

describe("parseContextWindowFromParams", () => {
  it("returns the max explicit context value from the context parameter", () => {
    const params = [
      { id: "context", values: [{ value: "auto" }, { value: "200k" }, { value: "1m" }] },
      { id: "thinking", values: [] },
    ];
    expect(parseContextWindowFromParams(params)).toBe(1_000_000);
  });

  it("returns undefined when there is no context parameter", () => {
    expect(parseContextWindowFromParams([{ id: "thinking", values: [] }])).toBeUndefined();
    expect(parseContextWindowFromParams(undefined)).toBeUndefined();
  });
});

describe("parseContextWindowFromId", () => {
  it("parses the @<size> suffix", () => {
    expect(parseContextWindowFromId("cursor/claude-opus-4-8@300k")).toBe(300_000);
    expect(parseContextWindowFromId("gpt-5.5@272k")).toBe(272_000);
    expect(parseContextWindowFromId("claude-opus-4-8@1m")).toBe(1_000_000);
  });

  it("returns undefined when no suffix is present", () => {
    expect(parseContextWindowFromId("cursor/composer-2-5")).toBeUndefined();
    expect(parseContextWindowFromId(undefined)).toBeUndefined();
  });
});

describe("resolveModelContextWindow", () => {
  it("prefers the context parameter over the id suffix", () => {
    const params = [{ id: "context", values: [{ value: "200k" }] }];
    expect(resolveModelContextWindow(params, "cursor/claude-opus-4-8@1m")).toBe(200_000);
  });

  it("falls back to the id suffix when no context param", () => {
    expect(resolveModelContextWindow(undefined, "cursor/claude-opus-4-8@1m")).toBe(1_000_000);
  });

  it("falls back to the bundled snapshot and then undefined", () => {
    expect(resolveModelContextWindow(undefined, "cursor/claude-sonnet-4-6")).toBe(200_000);
    expect(resolveModelContextWindow(undefined, "cursor/unknown-model")).toBeUndefined();
  });
});
