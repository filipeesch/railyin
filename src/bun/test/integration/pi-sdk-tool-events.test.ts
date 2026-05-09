import { describe, expect, it } from "vitest";
import { ScriptedEngine, scriptToolStart, scriptToolResult, scriptDone } from "../support/scripted-engine.ts";
import type { EngineEvent } from "../../engine/types.ts";

describe("SDK grep/find/ls tool events flow via ScriptedEngine", () => {
  it("V5: grep tool_start -> tool_result -> done", async () => {
    const engine = new ScriptedEngine();
    engine.queueTurn([
      scriptToolStart("t1", "grep", { pattern: "test", glob: "*.ts", limit: 10 }),
      scriptToolResult("t1", "grep", "src/test.ts:1: test content"),
      scriptDone(),
    ]);
    const events: EngineEvent[] = [];
    for await (const event of engine.execute({} as any)) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("V6: No search_text appears in tool registry events", async () => {
    const engine = new ScriptedEngine();
    engine.queueTurn([
      scriptToolStart("t1", "grep", { pattern: "regex", glob: "*.ts", limit: 10 }),
      scriptToolResult("t1", "grep", "[No matches]"),
      scriptDone(),
    ]);
    const events: EngineEvent[] = [];
    for await (const event of engine.execute({} as any)) {
      events.push(event);
    }
    for (const event of events) {
      if (event.type === "tool_start" && event.name === "search_text") {
        throw new Error("search_text should not appear in tool events");
      }
    }
  });

  it("V7: find tool events flow correctly", async () => {
    const engine = new ScriptedEngine();
    engine.queueTurn([
      scriptToolStart("f1", "find", { path: ".*.ts" }),
      scriptToolResult("f1", "find", "file.ts"),
      scriptDone(),
    ]);
    const events: EngineEvent[] = [];
    for await (const event of engine.execute({} as any)) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("V8: ls tool events flow correctly", async () => {
    const engine = new ScriptedEngine();
    engine.queueTurn([
      scriptToolStart("l1", "ls", {}),
      scriptToolResult("l1", "ls", "file.ts"),
      scriptDone(),
    ]);
    const events: EngineEvent[] = [];
    for await (const event of engine.execute({} as any)) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });
});
