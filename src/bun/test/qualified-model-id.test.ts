import { describe, it, expect } from "vitest";
import { QualifiedModelId } from "../engine/qualified-model-id.ts";

describe("QualifiedModelId", () => {
  // ─── parse() ──────────────────────────────────────────────────────────────

  it("QMI-1: 2-part copilot ID", () => {
    const q = QualifiedModelId.parse("copilot/gpt-4.1");
    expect(q.engineId).toBe("copilot");
    expect(q.providerId).toBeUndefined();
    expect(q.modelId).toBe("gpt-4.1");
    expect(q.nativeModelId()).toBe("gpt-4.1");
  });

  it("QMI-2: 2-part claude ID", () => {
    const q = QualifiedModelId.parse("claude/claude-sonnet-4-5");
    expect(q.engineId).toBe("claude");
    expect(q.providerId).toBeUndefined();
    expect(q.modelId).toBe("claude-sonnet-4-5");
    expect(q.nativeModelId()).toBe("claude-sonnet-4-5");
  });

  it("QMI-3: 3-part opencode ID with provider", () => {
    const q = QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5");
    expect(q.engineId).toBe("opencode");
    expect(q.providerId).toBe("anthropic");
    expect(q.modelId).toBe("claude-sonnet-4-5");
    expect(q.nativeModelId()).toBe("anthropic/claude-sonnet-4-5");
  });

  it("QMI-4: toString() round-trips 2-part", () => {
    const raw = "copilot/gpt-4.1";
    expect(QualifiedModelId.parse(raw).toString()).toBe(raw);
  });

  it("QMI-5: toString() round-trips 3-part", () => {
    const raw = "opencode/anthropic/claude-sonnet-4-5";
    expect(QualifiedModelId.parse(raw).toString()).toBe(raw);
  });

  it("QMI-6: parse('') throws", () => {
    expect(() => QualifiedModelId.parse("")).toThrow();
  });

  it("QMI-7: parse('noSlash') throws — single segment", () => {
    expect(() => QualifiedModelId.parse("noSlash")).toThrow();
  });

  it("QMI-8: parse('opencode/') throws — empty segment", () => {
    expect(() => QualifiedModelId.parse("opencode/")).toThrow();
  });

  it("QMI-9: two parses of same string are structurally equal", () => {
    const a = QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5");
    const b = QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5");
    expect(a.engineId).toBe(b.engineId);
    expect(a.providerId).toBe(b.providerId);
    expect(a.modelId).toBe(b.modelId);
    expect(a.toString()).toBe(b.toString());
  });

  // ─── tryParse() ───────────────────────────────────────────────────────────

  it("QMI-10: tryParse() returns null for null", () => {
    expect(QualifiedModelId.tryParse(null)).toBeNull();
  });

  it("QMI-11: tryParse() returns null for undefined", () => {
    expect(QualifiedModelId.tryParse(undefined)).toBeNull();
  });

  it("QMI-12: tryParse() returns null for invalid string", () => {
    expect(QualifiedModelId.tryParse("noSlash")).toBeNull();
  });

  it("QMI-13: tryParse() returns parsed value for valid string", () => {
    const q = QualifiedModelId.tryParse("copilot/gpt-4.1");
    expect(q).not.toBeNull();
    expect(q!.engineId).toBe("copilot");
  });

  // ─── isValid() ────────────────────────────────────────────────────────────

  it("QMI-14: isValid returns true for 2-part", () => {
    expect(QualifiedModelId.isValid("claude/claude-opus")).toBe(true);
  });

  it("QMI-15: isValid returns false for single segment", () => {
    expect(QualifiedModelId.isValid("noSlash")).toBe(false);
  });
});
