import { describe, expect, it, test, beforeEach, afterEach } from "vitest";
import { translateClaudeMessage, type ToolMetadata } from "../engine/claude/events.ts";

describe("Claude message translator - tool events", () => {
  describe("tool_use block detection and translation to tool_start", () => {
    test("emits tool_start event when assistant message contains tool_use block", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      const message = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_abc123",
              name: "search",
              input: { query: "Claude pricing" },
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_start",
        callId: "call_abc123",
        name: "search",
        arguments: JSON.stringify({ query: "Claude pricing" }),
        isInternal: false,
        display: { label: "search" },
      });
    });

    test("stores tool metadata in map for later pairing", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      const message = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_xyz789",
              name: "read_file",
              input: { path: "/etc/hosts" },
            },
          ],
        },
      };

      translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(toolMetaMap.get("call_xyz789")).toEqual({
        name: "read_file",
        arguments: { path: "/etc/hosts" },
      });
    });

    test("marks tools matching internal tool patterns as internal", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      const testCases = [
        { name: "internal_fallback", isInternal: true },
        { name: "claude_search", isInternal: true },
        { name: "report_intent", isInternal: true },
        { name: "search", isInternal: false },
        { name: "execute_command", isInternal: false },
      ];

      for (const { name, isInternal } of testCases) {
        const message = {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: `call_${name}`,
                name,
                input: {},
              },
            ],
          },
        };

        const events = translateClaudeMessage(message as any, { toolMetaByCallId: new Map() });
        const toolStart = events.find((e) => e.type === "tool_start");
        expect(toolStart?.isInternal).toBe(isInternal);
      }
    });

    test("handles multiple tool calls in single assistant message", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      const message = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "search",
              input: { q: "a" },
            },
            {
              type: "tool_use",
              id: "call_2",
              name: "read_file",
              input: { path: "x" },
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.type === "tool_start")).toBe(true);
      expect(toolMetaMap.size).toBe(2);
    });
  });

  describe("tool_result block detection and pairing", () => {
    test("emits tool_result event paired with preceding tool_use metadata", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      toolMetaMap.set("call_search_1", { name: "search", arguments: { query: "test" } });

      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_search_1",
              content: "Found 3 results",
              is_error: false,
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_result",
        callId: "call_search_1",
        name: "search",
        result: "Found 3 results",
        isError: false,
      });
    });

    test("removes paired tool_use from map to avoid reuse", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      toolMetaMap.set("call_123", { name: "search", arguments: {} });

      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "result",
            },
          ],
        },
      };

      translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(toolMetaMap.has("call_123")).toBe(false);
    });

    test("gracefully handles tool_result with unknown tool_use_id", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();

      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_unknown",
              content: "Some result",
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "tool_result",
        callId: "call_unknown",
        name: "unknown",
        result: "Some result",
        isError: false,
      });
    });

    test("marks tool_result as error when is_error flag is true", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      toolMetaMap.set("call_err", { name: "execute", arguments: {} });

      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_err",
              content: "Command failed",
              is_error: true,
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      expect(events[0].isError).toBe(true);
    });
  });

  describe("rate limit event handling", () => {
    test("emits status event for rate_limit_event in result message", () => {
      const message = {
        type: "result",
        subtype: "rate_limit_event",
      };

      const events = translateClaudeMessage(message as any);

      expect(events).toContainEqual({
        type: "status",
        message: "Claude API rate limited. Retrying...",
      });
    });

    test("includes usage stats even when rate limited", () => {
      const message = {
        type: "result",
        subtype: "rate_limit_event",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };

      const events = translateClaudeMessage(message as any);

      expect(events).toContainEqual({
        type: "usage",
        inputTokens: 100,
        outputTokens: 50,
      });
    });
  });

  describe("compaction_summary handling", () => {
    test("emits compaction_done for compaction_summary in system message", () => {
      const message = {
        type: "system",
        subtype: "compaction_summary",
        summary: "Concise summary of first part of discussion",
      };

      const events = translateClaudeMessage(message as any);

      expect(events).toContainEqual({ type: "compaction_done" });
    });

    test("skips empty compaction summary", () => {
      const message = {
        type: "system",
        subtype: "compaction_summary",
        summary: "",
      };

      const events = translateClaudeMessage(message as any);

      // Even with empty summary, compaction_done is still emitted (dedup handled in orchestrator)
      expect(events).toContainEqual({ type: "compaction_done" });
    });
  });

  describe("mixed message content", () => {
    test("handles assistant message with text, thinking, and tool_use blocks", () => {
      const toolMetaMap = new Map<string, ToolMetadata>();
      const message = {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Let me search for this" },
            { type: "text", text: "I'll help you find" },
            {
              type: "tool_use",
              id: "call_1",
              name: "search",
              input: { q: "test" },
            },
          ],
        },
      };

      const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

      // With includePartialMessages: true, text and thinking arrive via stream_event deltas.
      // The final assembled assistant message suppresses them to avoid double-emit.
      expect(events).toHaveLength(1);
      expect(events.map((e) => e.type)).toEqual(["tool_start"]);
    });
  });
});

describe("Claude message translator - stream_event handling", () => {
  test("translates text_delta to token event", () => {
    const message = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "token", content: "Hello" });
  });

  test("translates thinking_delta to reasoning event", () => {
    const message = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "reasoning", content: "Let me think..." });
  });

  test("ignores input_json_delta (tool arg streaming)", () => {
    const message = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"q":' },
      },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(0);
  });

  test("ignores non-content_block_delta stream events", () => {
    const message = {
      type: "stream_event",
      event: { type: "content_block_start", content_block: { type: "text", text: "" } },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(0);
  });

  test("ignores stream_event with no event payload", () => {
    const events = translateClaudeMessage({ type: "stream_event" } as any);
    expect(events).toHaveLength(0);
  });
});

describe("Claude message translator - assistant dedup (text/thinking suppression)", () => {
  test("text-only assistant message emits no events", () => {
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Some response text" }],
      },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(0);
  });

  test("thinking-only assistant message emits no events", () => {
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "My internal reasoning" }],
      },
    };

    const events = translateClaudeMessage(message as any);

    expect(events).toHaveLength(0);
  });

  test("assistant message with only tool_use still emits tool_start", () => {
    const toolMetaMap = new Map();
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "call_abc", name: "read_file", input: { path: "x.ts" } }],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_start");
  });

  test("assistant message with text + tool_use emits only tool_start", () => {
    const toolMetaMap = new Map();
    const message = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Here is the file:" },
          { type: "tool_use", id: "call_xyz", name: "write", input: { file_path: "out.ts", content: "" } },
        ],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: toolMetaMap });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_start");
  });
});

describe("Claude message translator - MCP-prefixed tool name handling", () => {
  test("strips mcp__railyin__ prefix and routes to common display for known tools", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call_mcp1",
            name: "mcp__railyin__decision_request",
            input: { questions: [] },
          },
        ],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: new Map() });
    const toolStart = events.find((e) => e.type === "tool_start");

    expect(toolStart?.name).toBe("decision_request");
    expect(toolStart?.display?.label).toBe("decision request");
  });

  test("strips mcp__railyin__ prefix before isInternal check — report_intent is filtered", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call_intent",
            name: "mcp__railyin__report_intent",
            input: { intent: "Exploring codebase" },
          },
        ],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: new Map() });
    const toolStart = events.find((e) => e.type === "tool_start");

    expect(toolStart?.isInternal).toBe(true);
  });

  test("external MCP tool name is humanized via humanizeToolName fallback", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call_ext",
            name: "mcp__other-server__do_thing",
            input: {},
          },
        ],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: new Map() });
    const toolStart = events.find((e) => e.type === "tool_start");

    expect(toolStart?.display?.label).toBe("other-server do thing");
  });

  test("plain unknown tool name is humanized with underscores replaced by spaces", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call_custom",
            name: "my_custom_tool",
            input: {},
          },
        ],
      },
    };

    const events = translateClaudeMessage(message as any, { toolMetaByCallId: new Map() });
    const toolStart = events.find((e) => e.type === "tool_start");

    expect(toolStart?.display?.label).toBe("my custom tool");
  });
});

// ─── FileStateCache integration with translateClaudeMessage ──────────────────

import { StubFileStateCache } from "./support/stub-file-state-cache.ts";

describe("FileStateCache integration with translateClaudeMessage", () => {
  let stub: StubFileStateCache;
  let toolMetaMap: Map<string, { name: string; arguments?: unknown }>;

  beforeEach(() => {
    stub = new StubFileStateCache();
    toolMetaMap = new Map();
  });

  afterEach(() => {
    stub.reset();
  });

  test("CE-WF-1: write with existing-file before-content → correct added/removed", () => {
    const beforeContent = "line1\nline2\nline3\n";
    const afterContent = "line1\nCHANGED\nline3\n";
    const callId = "call-write-1";

    stub.preset(callId, beforeContent);
    toolMetaMap.set(callId, { name: "write", arguments: { file_path: "test.txt" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: JSON.stringify({ detailedContent: afterContent }),
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    expect(events).toHaveLength(1);
    const toolResult = events[0] as any;
    expect(toolResult.type).toBe("tool_result");
    expect(toolResult.writtenFiles).toHaveLength(1);
    expect(toolResult.writtenFiles[0].added).toBe(1);
    expect(toolResult.writtenFiles[0].removed).toBe(1);
    expect(toolResult.writtenFiles[0].hunks).toHaveLength(1);
    expect(toolResult.writtenFiles[0].is_new).toBeUndefined();
  });

  test("CE-WF-2: write with null before-content → is_new: true, removed: 0", () => {
    const afterContent = "brand new file\nline 2\n";
    const callId = "call-write-new";

    stub.preset(callId, null); // signals new file
    toolMetaMap.set(callId, { name: "write", arguments: { file_path: "new.txt" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: JSON.stringify({ detailedContent: afterContent }),
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles[0].is_new).toBe(true);
    expect(toolResult.writtenFiles[0].removed).toBe(0);
    expect(toolResult.writtenFiles[0].added).toBeGreaterThan(0);
  });

  test("CE-WF-3: write with undefined before-content (not captured) → shallow fallback", () => {
    // No preset for this callId → get() returns undefined
    toolMetaMap.set("call-uncaptured", { name: "write", arguments: { file_path: "x.txt" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: "call-uncaptured",
          content: "result",
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles).toHaveLength(1);
    expect(toolResult.writtenFiles[0].added).toBe(0);
    expect(toolResult.writtenFiles[0].removed).toBe(0);
    expect(toolResult.writtenFiles[0].hunks).toBeUndefined();
  });

  test("CE-EF-1: edit with string before-content → correct hunk diff", () => {
    const beforeContent = "function foo() {\n  return 1;\n}\n";
    const afterContent = "function foo() {\n  return 42;\n}\n";
    const callId = "call-edit-1";

    stub.preset(callId, beforeContent);
    toolMetaMap.set(callId, { name: "edit", arguments: { file_path: "app.ts" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: JSON.stringify({ detailedContent: afterContent }),
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles[0].operation).toBe("edit_file");
    expect(toolResult.writtenFiles[0].added).toBe(1);
    expect(toolResult.writtenFiles[0].removed).toBe(1);
  });

  test("CE-MF-1: multiedit with string before-content → correct hunk diff", () => {
    const beforeContent = "a\nb\nc\n";
    const afterContent = "A\nB\nC\n";
    const callId = "call-multi-1";

    stub.preset(callId, beforeContent);
    toolMetaMap.set(callId, { name: "multiedit", arguments: { file_path: "data.txt" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: JSON.stringify({ detailedContent: afterContent }),
          is_error: false,
        }],
      },
    };

    const events = translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    const toolResult = events[0] as any;
    expect(toolResult.writtenFiles[0].operation).toBe("edit_file");
    expect(toolResult.writtenFiles[0].added).toBe(3);
    expect(toolResult.writtenFiles[0].removed).toBe(3);
  });

  test("CE-DEL-1: after tool_result translated, stub.trace.deleted contains the callId", () => {
    const beforeContent = "old content";
    const callId = "call-delete-me";

    stub.preset(callId, beforeContent);
    toolMetaMap.set(callId, { name: "write", arguments: { file_path: "del.txt" } });

    const message = {
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: callId,
          content: "new content",
          is_error: false,
        }],
      },
    };

    translateClaudeMessage(message as any, {
      toolMetaByCallId: toolMetaMap,
      fileStateCache: stub,
      worktreePath: "/fake",
    });

    expect(stub.trace.deleted).toContain(callId);
    // After delete, get() should return undefined
    expect(stub.get(callId)).toBeUndefined();
  });
});

