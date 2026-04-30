import { describe, expect, it } from "vitest";
import { translateCopilotStream } from "../engine/copilot/events.ts";
import {
  MockCopilotSession,
  done,
  toolResult,
  toolStart,
} from "./support/copilot-sdk-mock.ts";
import type { EngineEvent } from "../engine/types.ts";

async function collectEvents(session: MockCopilotSession): Promise<EngineEvent[]> {
  const sendPromise = session.send({ prompt: "test" });
  const events: EngineEvent[] = [];
  for await (const event of translateCopilotStream(session, undefined, sendPromise)) {
    events.push(event);
  }
  return events;
}

describe("Copilot event translation writtenFiles extraction", () => {
  it("maps create and edit tool arguments to write_file and edit_file", async () => {
    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("c1", "create", { path: "src/new.ts", file_text: "x" }),
        toolResult("c1", "ok"),
        toolStart("c2", "edit", { path: "src/edit.ts", old_string: "a", new_string: "b" }),
        toolResult("c2", "ok"),
        done(),
      ],
    });

    const events = await collectEvents(session);
    const results = events.filter((e): e is Extract<EngineEvent, { type: "tool_result" }> => e.type === "tool_result");

    expect(results).toHaveLength(2);
    expect(results[0]?.writtenFiles).toEqual([
      { operation: "write_file", path: "src/new.ts", added: 0, removed: 0 },
    ]);
    expect(results[1]?.writtenFiles).toEqual([
      { operation: "edit_file", path: "src/edit.ts", added: 0, removed: 0 },
    ]);
  });

  it("extracts add/delete/update/rename entries from apply_patch string payload", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/added.ts",
      "*** Delete File: src/deleted.ts",
      "*** Update File: src/updated.ts",
      "*** Update File: src/old.ts -> src/new.ts",
      "*** End Patch",
    ].join("\n");

    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("c1", "apply_patch", patch),
        toolResult("c1", "ok"),
        done(),
      ],
    });

    const events = await collectEvents(session);
    const result = events.find((e): e is Extract<EngineEvent, { type: "tool_result" }> => e.type === "tool_result");

    expect(result?.writtenFiles).toEqual([
      { operation: "write_file", path: "src/added.ts", added: 0, removed: 0, is_new: true },
      { operation: "delete_file", path: "src/deleted.ts", added: 0, removed: 0 },
      { operation: "patch_file", path: "src/updated.ts", added: 0, removed: 0 },
      { operation: "rename_file", path: "src/old.ts", to_path: "src/new.ts", added: 0, removed: 0 },
    ]);
  });

  it("normalizes apply_patch object wrappers: patch, input, and arguments", async () => {
    const cases: Array<Record<string, unknown>> = [
      { patch: "*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch" },
      { input: "*** Begin Patch\n*** Update File: src/b.ts\n*** End Patch" },
      { arguments: "*** Begin Patch\n*** Update File: src/c.ts\n*** End Patch" },
    ];

    for (const [index, args] of cases.entries()) {
      const callId = `c${index + 1}`;
      const session = new MockCopilotSession().queueTurn({
        steps: [toolStart(callId, "apply_patch", args), toolResult(callId, "ok"), done()],
      });

      const events = await collectEvents(session);
      const result = events.find((e): e is Extract<EngineEvent, { type: "tool_result" }> => e.type === "tool_result");
      expect(result?.writtenFiles?.[0]?.operation).toBe("patch_file");
      expect(typeof result?.writtenFiles?.[0]?.path).toBe("string");
    }
  });

  it("returns no writtenFiles for unsupported tools or invalid arguments", async () => {
    const session = new MockCopilotSession().queueTurn({
      steps: [
        toolStart("c1", "create", {}),
        toolResult("c1", "ok"),
        toolStart("c2", "apply_patch", { nope: true }),
        toolResult("c2", "ok"),
        toolStart("c3", "read_file", { path: "src/a.ts" }),
        toolResult("c3", "ok"),
        done(),
      ],
    });

    const events = await collectEvents(session);
    const results = events.filter((e): e is Extract<EngineEvent, { type: "tool_result" }> => e.type === "tool_result");

    expect(results).toHaveLength(3);
    expect(results[0]?.writtenFiles).toBeUndefined();
    expect(results[1]?.writtenFiles).toBeUndefined();
    expect(results[2]?.writtenFiles).toBeUndefined();
  });
});
