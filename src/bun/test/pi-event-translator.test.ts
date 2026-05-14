/**
 * Tests for Pi engine event-translator and related compaction-path config.
 */
import { describe, expect, it } from "vitest";
import { translateEvent } from "../engine/pi/event-translator.ts";
import { buildPiToolDisplay } from "../engine/pi/tools/display.ts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// ─── Compaction event translation ────────────────────────────────────────────

describe("translateEvent — compaction events", () => {
  it("ET-C1: compaction_start emits a compaction_start engine event", () => {
    const event: AgentSessionEvent = {
      type: "compaction_start",
      reason: "context_limit",
    } as unknown as AgentSessionEvent;

    const result = translateEvent(event);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "compaction_start" });
  });

  it("ET-C2: compaction_end with result emits a compaction_done engine event", () => {
    const event: AgentSessionEvent = {
      type: "compaction_end",
      aborted: false,
      willRetry: false,
      result: {
        summary: "Context was compacted. The project is a TypeScript monorepo.",
        firstKeptEntryId: "entry-42",
        tokensBefore: 120_000,
      },
    } as unknown as AgentSessionEvent;

    const result = translateEvent(event);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "compaction_done",
      summary: "Context was compacted. The project is a TypeScript monorepo.",
    });
  });

  it("ET-C3: compaction_end aborted emits nothing", () => {
    const event: AgentSessionEvent = {
      type: "compaction_end",
      aborted: true,
      willRetry: true,
      result: undefined,
    } as unknown as AgentSessionEvent;

    const result = translateEvent(event);

    expect(result).toHaveLength(0);
  });

  it("ET-C4: compaction_end with no summary emits nothing", () => {
    const event: AgentSessionEvent = {
      type: "compaction_end",
      aborted: false,
      willRetry: false,
      result: { summary: "", firstKeptEntryId: "x", tokensBefore: 100 },
    } as unknown as AgentSessionEvent;

    const result = translateEvent(event);

    expect(result).toHaveLength(0);
  });
});

// ─── PiEngineConfig — context_window propagation ──────────────────────────────

describe("PiEngineConfig — context_window field", () => {
  it("ET-CW1: PiEngineConfig accepts context_window without type error", () => {
    // This is a compile-time check via assignment; if it doesn't compile the
    // TypeScript build will fail before this test even runs.
    const config: import("../config/index.ts").PiEngineConfig = {
      type: "pi",
      model: "lmstudio/qwen3-8b",
      context_window: 8_192,
    };

    expect(config.context_window).toBe(8_192);
  });

  it("ET-CW2: PiEngineConfig context_window is optional", () => {
    const config: import("../config/index.ts").PiEngineConfig = {
      type: "pi",
      model: "lmstudio/qwen3-8b",
    };

    expect(config.context_window).toBeUndefined();
  });
});

// ─── buildPiToolDisplay — SDK built-in tools ──────────────────────────────────

describe("buildPiToolDisplay — SDK built-in tools", () => {
  it("ET-DISPLAY-1: read tool renders file path relative to worktree", () => {
    const result = buildPiToolDisplay("read", { file_path: "/repo/src/a.ts" }, "/repo");
    expect(result).toMatchObject({ label: "read", subject: "src/a.ts", contentType: "file" });
  });

  it("ET-DISPLAY-2: grep tool renders pattern as subject", () => {
    const result = buildPiToolDisplay("grep", { pattern: "myFunc" });
    expect(result).toMatchObject({ label: "grep", contentType: "terminal" });
    expect(result.subject).toBe("myFunc");
  });

  it("ET-DISPLAY-3: find tool renders pattern as subject", () => {
    const result = buildPiToolDisplay("find", { pattern: "*.ts" });
    expect(result).toMatchObject({ label: "find", contentType: "terminal" });
    expect(result.subject).toBe("*.ts");
  });

  it("ET-DISPLAY-4: ls tool renders path relative to worktree", () => {
    const result = buildPiToolDisplay("ls", { path: "/repo/src" }, "/repo");
    expect(result).toMatchObject({ label: "ls", contentType: "terminal" });
    expect(result.subject).toBe("src");
  });

  it("ET-DISPLAY-5: search_text falls through to common display (not hardcoded 'search' label)", () => {
    const result = buildPiToolDisplay("search_text", { pattern: "x" });
    expect(result.label).not.toBe("search");
  });
});
