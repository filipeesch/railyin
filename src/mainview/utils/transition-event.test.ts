import { describe, expect, it } from "vitest";
import {
  formatTransitionSummary,
  getTransitionInstructionText,
  getTransitionInstructionSegments,
  normalizeTransitionEventMetadata,
} from "./transition-event";

describe("normalizeTransitionEventMetadata", () => {
  it("keeps legacy transition metadata readable", () => {
    expect(normalizeTransitionEventMetadata({ from: "Explore", to: "Apply" })).toEqual({
      from: "Explore",
      to: "Apply",
    });
  });

  it("normalizes enriched instruction detail metadata", () => {
    expect(normalizeTransitionEventMetadata({
      from: "Explore",
      to: "Apply",
      instructionDetail: {
        displayText: "  /opsx:apply [#src/app.ts|#app.ts]  ",
        sourceText: " /opsx:apply ",
        sourceKind: "slash",
        sourceRef: " /opsx:apply ",
      },
    })).toEqual({
      from: "Explore",
      to: "Apply",
      instructionDetail: {
        displayText: "/opsx:apply [#src/app.ts|#app.ts]",
        sourceText: "/opsx:apply",
        sourceKind: "slash",
        sourceRef: "/opsx:apply",
      },
    });
  });

  it("returns null for unusable metadata", () => {
    expect(normalizeTransitionEventMetadata({ foo: "bar" })).toBeNull();
    expect(normalizeTransitionEventMetadata(null)).toBeNull();
  });
});

describe("formatTransitionSummary", () => {
  it("uses exact workflow wording with both target and source", () => {
    expect(formatTransitionSummary({ from: "Explore", to: "Apply" })).toBe("Moved to Apply from Explore");
  });

  it("falls back safely when the source column is missing", () => {
    expect(formatTransitionSummary({ to: "Done" })).toBe("Moved to Done");
    expect(formatTransitionSummary(null)).toBe("Moved to ?");
  });
});

describe("getTransitionInstructionSegments", () => {
  it("prefers the authored slash text for visible transition instructions", () => {
    expect(getTransitionInstructionText({
      to: "Apply",
      instructionDetail: {
        displayText: "Expanded instructions for transition card",
        sourceText: "/opsx:apply transition card",
        sourceKind: "slash",
        sourceRef: "/opsx:apply",
      },
    })).toBe("/opsx:apply transition card");
  });

  it("reuses shared chip segmentation for transition instructions", () => {
    expect(getTransitionInstructionSegments({
      to: "Apply",
      instructionDetail: {
        displayText: "Expanded instructions for transition card",
        sourceText: "Run [/opsx:apply|/opsx:apply] with [#src/app.ts|#app.ts] via [@chrome-devtools:click|@click]",
        sourceKind: "slash",
      },
    })).toEqual([
      { type: "text", text: "Run " },
      {
        type: "chip",
        chip: { raw: "[/opsx:apply|/opsx:apply]", ref: "/opsx:apply", label: "/opsx:apply" },
        label: "/opsx:apply",
        kind: "slash",
      },
      { type: "text", text: " with " },
      {
        type: "chip",
        chip: { raw: "[#src/app.ts|#app.ts]", ref: "#src/app.ts", label: "#app.ts" },
        label: "#app.ts",
        kind: "file",
      },
      { type: "text", text: " via " },
      {
        type: "chip",
        chip: {
          raw: "[@chrome-devtools:click|@click]",
          ref: "@chrome-devtools:click",
          label: "@click",
        },
        label: "@click",
        kind: "tool",
      },
    ]);
  });

  it("returns an empty segment list when there are no instructions", () => {
    expect(getTransitionInstructionSegments({ from: "Plan", to: "Done" })).toEqual([]);
  });
});
