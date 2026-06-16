// @cursor/sdk worker — runs in a Node.js subprocess spawned by the Bun parent.
//
// This is the only .mjs file in the codebase; everything else runs under Bun
// via TypeScript. The extension is what tells Bun's child_process.spawn() to
// hand this file to plain Node — see ./worker-client.ts.
//
// Why Node and not Bun: Bun's HTTP/2 client has a bug where session.settings()
// updates JS-visible state and the server ACKs, but nghttp2's internal
// max_frame_size for inbound validation stays at 16 KB. The Cursor backend
// streams DATA frames > 16 KB, so any meaningful run fails with
// NGHTTP2_FRAME_SIZE_ERROR. Node's http2 honors session.settings() correctly.
//
// IPC: line-delimited JSON on stdin/stdout. Stderr is reserved for human logs.
// Wire protocol types live in ./worker-protocol.ts (TypeScript — duplicated
// here verbatim because Node can't import the TS file directly).

import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { Agent, Cursor } from "@cursor/sdk";
import { resumeOrCreateAgent } from "./worker-resume.mjs";

// The SDK assigns its own agent id when Agent.create is called without one,
// but it also honors a caller-supplied id (AgentOptions.agentId is forwarded
// to the underlying local store). We pass the same deterministic id on every
// turn so resume always finds the prior conversation state.

// The Cursor SDK registers abort listeners on shared internal AbortSignals
// per Agent.create()/resume() call and doesn't always tear them down on
// agent.close(). Across many turns the count crosses Node's default of 10
// and triggers a MaxListenersExceededWarning. Disabling the cap here is
// safe — this worker is dedicated to the SDK and has no other listener
// sources we need to monitor.
setMaxListeners(0);

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + "\n");
};

const log = (level, message) => {
  send({ type: "log", level, message });
};

// runId -> { agent, run, abort, pendingTools: Map<callId, {resolve, reject}> }
const runs = new Map();

function makeProxyTool(runId, schema) {
  return {
    description: schema.description,
    inputSchema: schema.inputSchema,
    execute: async (args) => {
      const state = runs.get(runId);
      if (!state) return "Error: run no longer active";
      const callId = randomUUID();
      return new Promise((resolve, reject) => {
        state.pendingTools.set(callId, { resolve, reject });
        send({ type: "toolCall", runId, callId, toolName: schema.name, args });
      });
    },
  };
}

async function handleStartRun(msg) {
  const { runId, apiKey, workingDirectory, model, prompt, toolSchemas, agentId } = msg;
  const customTools = {};
  for (const schema of toolSchemas) {
    customTools[schema.name] = makeProxyTool(runId, schema);
  }

  const state = { agent: null, run: null, pendingTools: new Map(), aborted: false };
  runs.set(runId, state);

  try {
    const baseOptions = {
      model: model ? { id: model } : undefined,
      apiKey,
      local: { cwd: workingDirectory, customTools },
    };

    state.agent = await resumeOrCreateAgent(Agent, agentId, baseOptions);
    state.run = await state.agent.send(prompt);

    for await (const message of state.run.stream()) {
      if (state.aborted) break;
      send({ type: "rawMessage", runId, message });
      const events = translateCursorMessage(message);
      for (const event of events) {
        send({ type: "event", runId, event });
      }
    }

    if (!state.aborted) {
      try {
        const result = await state.run.wait();
        if (result.status === "error") {
          send({
            type: "runDone",
            runId,
            status: "error",
            detail: typeof result.result === "string" ? result.result : undefined,
          });
        } else {
          send({ type: "runDone", runId, status: "ok" });
        }
      } catch (waitErr) {
        send({
          type: "runDone",
          runId,
          status: "error",
          detail: `wait() threw: ${waitErr instanceof Error ? waitErr.message : String(waitErr)}`,
        });
      }
    } else {
      send({ type: "runDone", runId, status: "ok" });
    }
  } catch (err) {
    send({
      type: "runDone",
      runId,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (state.run) {
      state.run.cancel().catch(() => {});
    }
    if (state.agent) {
      try { state.agent.close(); } catch {}
    }
    // Reject any tool calls still pending — Bun will not send results.
    for (const { reject } of state.pendingTools.values()) {
      reject(new Error("run terminated"));
    }
    runs.delete(runId);
  }
}

function handleCancelRun(msg) {
  const state = runs.get(msg.runId);
  if (!state) return;
  state.aborted = true;
  if (state.run) {
    state.run.cancel().catch(() => {});
  }
}

function handleToolResult(msg) {
  for (const state of runs.values()) {
    const pending = state.pendingTools.get(msg.callId);
    if (pending) {
      state.pendingTools.delete(msg.callId);
      if (msg.error !== undefined) {
        pending.resolve(`Error: ${msg.error}`);
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
  }
}

async function handleListModels(msg) {
  try {
    if (!msg.apiKey) {
      send({ type: "response", requestId: msg.requestId, result: [] });
      return;
    }
    const models = await Cursor.models.list({ apiKey: msg.apiKey });
    const mapped = models.map((m) => ({
      value: m.id,
      displayName: m.displayName,
      description: m.description,
    }));
    send({ type: "response", requestId: msg.requestId, result: mapped });
  } catch (err) {
    send({
      type: "response",
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleShutdown() {
  for (const state of runs.values()) {
    state.aborted = true;
    if (state.run) state.run.cancel().catch(() => {});
    if (state.agent) { try { state.agent.close(); } catch {} }
  }
  process.exit(0);
}

/**
 * Translation of @cursor/sdk message stream to Railyn EngineEvent shapes.
 * Mirrors src/bun/engine/cursor/events.ts — duplicated here to avoid pulling
 * the TS toolchain into the Node worker.
 */
// Mirrors normalizeCursorToolResult in events.ts. Cursor wraps custom-tool
// results in { status, value: { content: [{ text: { text: "..." } }],
// isError } } and SDK builtins in { type: "tool_result", content, is_error }
// where `content` can be a string or array of { type: "text", text } blocks.
function extractTextFromBlock(b) {
  if (typeof b === "string") return b;
  if (!b || typeof b !== "object") return "";
  if (b.text && typeof b.text === "object" && typeof b.text.text === "string") return b.text.text;
  if (typeof b.text === "string") return b.text;
  return "";
}

function extractCursorContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(extractTextFromBlock).filter((t) => t.length > 0).join("\n");
}

function normalizeCursorToolResult(rawResult) {
  if (rawResult == null) return "";
  if (typeof rawResult === "string") return rawResult;
  if (typeof rawResult !== "object") return String(rawResult);
  if (typeof rawResult.status === "string" && rawResult.value !== undefined) {
    return normalizeCursorToolResult(rawResult.value);
  }
  if (rawResult.type === "tool_result") return extractCursorContent(rawResult.content);
  if (Array.isArray(rawResult.content)) return extractCursorContent(rawResult.content);
  if (typeof rawResult.content === "string") return rawResult.content;
  if (typeof rawResult.text === "string") return rawResult.text;
  try { return JSON.stringify(rawResult, null, 2); } catch { return String(rawResult); }
}

function translateCursorMessage(message) {
  const events = [];
  switch (message.type) {
    case "assistant": {
      const content = message.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      if (content) events.push({ type: "token", content });
      break;
    }
    case "thinking": {
      if (message.text) events.push({ type: "reasoning", content: message.text });
      break;
    }
    case "tool_call": {
      // Cursor wraps every custom-tool call under name "mcp" with the real
      // tool name nested at args.toolName and real args at args.args.
      const isMcpEnvelope = message.name === "mcp" && message.args && typeof message.args.toolName === "string";
      const resolvedName = isMcpEnvelope ? message.args.toolName : message.name;
      const resolvedArgs = isMcpEnvelope ? (message.args.args ?? {}) : (message.args ?? {});
      if (message.status === "running") {
        events.push({
          type: "tool_start",
          name: resolvedName,
          arguments: JSON.stringify(resolvedArgs),
          callId: message.call_id,
        });
      } else if (message.status === "completed" || message.status === "error") {
        const isError = message.status === "error";
        const text = normalizeCursorToolResult(message.result);
        const result = text.length > 0 ? text : isError ? "(tool returned an error with no message)" : "(no output)";
        events.push({
          type: "tool_result",
          name: resolvedName,
          result,
          callId: message.call_id,
          isError,
        });
      }
      break;
    }
    case "status": {
      events.push({ type: "status", message: message.message ?? "" });
      break;
    }
  }
  return events;
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) {
    log("error", `failed to parse incoming line: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  switch (msg.type) {
    case "startRun":     handleStartRun(msg).catch((e) => log("error", `startRun crashed: ${e?.message}`)); break;
    case "cancelRun":    handleCancelRun(msg); break;
    case "toolResult":   handleToolResult(msg); break;
    case "listModels":   handleListModels(msg).catch((e) => log("error", `listModels crashed: ${e?.message}`)); break;
    case "shutdown":     handleShutdown(); break;
    default:             log("warn", `unknown message type: ${msg.type}`);
  }
});

process.on("uncaughtException", (err) => log("error", `uncaughtException: ${err?.message ?? err}`));
process.on("unhandledRejection", (err) => log("error", `unhandledRejection: ${err instanceof Error ? err.message : String(err)}`));

send({ type: "ready" });
