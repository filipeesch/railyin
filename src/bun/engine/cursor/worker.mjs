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
import { PersistentBusyError, sendPromptWithRecovery } from "./worker-recovery.mjs";

export { PersistentBusyError, sendPromptWithRecovery, sendWithBusyRetry } from "./worker-recovery.mjs";

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

/**
 * Build the base options for Agent.create / Agent.resume.
 * settingSources: ["project"] ensures .cursorrules and .cursor/rules/*.mdc
 * are loaded automatically from the working directory.
 */
export function buildBaseOptions(apiKey, model, workingDirectory, customTools) {
  return {
    model: model ? { id: model } : undefined,
    apiKey,
    local: {
      cwd: workingDirectory,
      customTools,
      settingSources: ["project"],
    },
  };
}

async function handleStartRun(msg) {
  const { runId, executionId, conversationId, apiKey, workingDirectory, model, prompt, toolSchemas, agentId } = msg;
  const customTools = {};
  for (const schema of toolSchemas) {
    customTools[schema.name] = makeProxyTool(runId, schema);
  }

  const state = { agent: null, run: null, pendingTools: new Map(), aborted: false };
  runs.set(runId, state);

  try {
    const baseOptions = buildBaseOptions(apiKey, model, workingDirectory, customTools);

    const result = await sendPromptWithRecovery(Agent, agentId, baseOptions, prompt, {
      runId,
      executionId,
      taskId: msg.taskId,
      conversationId,
      log,
    });
    state.agent = result.agent;
    state.run = result.run;

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
    if (err instanceof PersistentBusyError) {
      log("error", JSON.stringify({
        event: "cursor_run_failed",
        failureKind: err.failureKind,
        runId,
        executionId,
        taskId: msg.taskId,
        conversationId,
        agentId: agentId ?? null,
        detail: err.message,
      }));
    }
    send({
      type: "runDone",
      runId,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      ...(err instanceof PersistentBusyError ? { failureKind: err.failureKind } : {}),
    });
  } finally {
    await finalizeRunState(state);
    // Reject any tool calls still pending — Bun will not send results.
    for (const { reject } of state.pendingTools.values()) {
      reject(new Error("run terminated"));
    }
    runs.delete(runId);
  }
}

async function finalizeRunState(state) {
  if (state.run) {
    await state.run.cancel().catch(() => {});
  }
  if (state.agent) {
    try {
      await state.agent.close();
    } catch {}
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
 *
 * INLINE COPY of src/bun/engine/cursor/translate-events.ts — kept here because
 * worker.mjs runs under plain Node (not Bun) and cannot import .ts files.
 *
 * CRITICAL: This copy MUST stay in sync with translate-events.ts.
 * When updating translate-events.ts, copy the changes here.
 * See translate-events.ts for the canonical implementation.
 */

// ─── MCP Envelope Unwrapping ───

function unwrapCursorToolName(name, args) {
  if (name === "mcp" && args && typeof args.toolName === "string") {
    return {
      name: args.toolName,
      args: args.args ?? {},
    };
  }
  return { name, args: args ?? {} };
}

// ─── Normalize Cursor Tool Result ───

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

// ─── Structured Result Extraction ───

function extractStructuredResult(rawResult) {
  if (rawResult == null || typeof rawResult !== "object") return {};
  const obj = rawResult;

  // Unwrap Cursor's { status, value } envelope
  if (typeof obj.status === "string" && obj.value !== undefined) {
    return extractStructuredResult(obj.value);
  }

  const value = obj;

  // Shell: { exitCode, signal, stdout, stderr }
  if (typeof value.exitCode === "number" || typeof value.stdout === "string") {
    const stdout = typeof value.stdout === "string" ? value.stdout : "";
    const stderr = typeof value.stderr === "string" && value.stderr ? "\n" + value.stderr : "";
    return { detailedResult: stdout + stderr };
  }

  // Edit/Write: { linesAdded, linesRemoved, diffString }
  if (typeof value.diffString === "string" && value.diffString.includes("@@")) {
    const linesAdded = typeof value.linesAdded === "number" ? value.linesAdded : 0;
    const linesRemoved = typeof value.linesRemoved === "number" ? value.linesRemoved : 0;
    const diffPath = extractPathFromDiff(value.diffString);
    return {
      writtenFiles: [{
        operation: "edit_file",
        path: diffPath || "unknown",
        added: linesAdded,
        removed: linesRemoved,
        hunks: parseUnifiedDiff(value.diffString, diffPath || "unknown", "edit_file"),
      }],
    };
  }

  // Delete: { } (empty value)
  if (Object.keys(value).length === 0) {
    return { detailedResult: "(file deleted)" };
  }

  // Read: { content: "..." }
  if (typeof value.content === "string") {
    return { detailedResult: value.content };
  }

  // Fallback: JSON stringify
  try {
    return { detailedResult: JSON.stringify(rawResult, null, 2) };
  } catch {
    return {};
  }
}

function extractPathFromDiff(diffString) {
  const lines = diffString.split("\n");
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const raw = line.slice(4).trim().replace(/^[ab]\//, "");
      if (raw !== "/dev/null") return raw;
    }
  }
  return undefined;
}

function parseUnifiedDiff(diffText, fallbackPath, operation) {
  const lines = diffText.split("\n");
  const hunks = [];
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      currentHunk = { old_start: Number(header[1]), new_start: Number(header[2]), lines: [] };
      hunks.push(currentHunk);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+") && !line.startsWith("++")) {
      currentHunk.lines.push({ type: "added", new_line: newLine, content: line.slice(1) });
      newLine++;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("--")) {
      currentHunk.lines.push({ type: "removed", old_line: oldLine, content: line.slice(1) });
      oldLine++;
      continue;
    }
    if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", old_line: oldLine, new_line: newLine, content: line.slice(1) });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

// ─── Build Display Metadata ───

function humanizeToolName(name) {
  let result = name;
  if (result.startsWith("mcp__")) result = result.slice(5);
  result = result.replace(/__/g, " ").replace(/_/g, " ");
  return result;
}

function stripWorktreePath(subject, worktreePath) {
  if (!subject) return undefined;
  if (worktreePath && subject.startsWith(worktreePath)) {
    const stripped = subject.slice(worktreePath.length);
    return stripped.startsWith("/") ? stripped.slice(1) : stripped;
  }
  return subject;
}

function canonicalToolDisplayLabel(name) {
  const map = { read: "read", write: "write", edit: "edit", bash: "bash", grep: "grep", glob: "glob", ls: "ls", delete: "delete", webfetch: "web fetch" };
  return map[name] ?? name;
}

function buildCursorToolDisplay(name, args, worktreePath) {
  const str = (v) => (v != null ? String(v) : "");
  const lowerName = name.toLowerCase();
  switch (lowerName) {
    case "read":
    case "railyin_read":
      return { label: "read", subject: stripWorktreePath(str(args.path || args.file_path), worktreePath), contentType: "file" };
    case "write":
    case "railyin_write":
      return { label: "write", subject: stripWorktreePath(str(args.path || args.file_path), worktreePath), contentType: "file" };
    case "edit":
    case "multedit":
    case "railyin_edit":
      return { label: "edit", subject: stripWorktreePath(str(args.path || args.file_path), worktreePath), contentType: "file" };
    case "shell":
    case "bash":
    case "railyin_shell":
      return { label: "bash", subject: stripWorktreePath(str(args.command || args.cmd), worktreePath), contentType: "terminal" };
    case "grep":
    case "railyin_grep":
      return { label: "grep", subject: str(args.pattern || args.query) };
    case "glob":
    case "railyin_glob":
      return { label: "glob", subject: str(args.pattern) };
    case "delete":
      return { label: "delete", subject: stripWorktreePath(str(args.path || args.file_path), worktreePath), contentType: "file" };
    case "ls":
    case "list":
      return { label: "ls", subject: stripWorktreePath(str(args.path), worktreePath) };
    case "webfetch":
    case "web_fetch":
      return { label: "web fetch", subject: str(args.url) };
    default:
      return { label: humanizeToolName(name) };
  }
}

// ─── Translate SDK Message to EngineEvents ───

function translateCursorMessage(message) {
  const events = [];
  switch (message.type) {
    case "assistant": {
      const contentBlocks = message.messageObj?.content ?? message.message?.content ?? [];
      const content = contentBlocks
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
      const { name: resolvedName, args: resolvedArgs } = unwrapCursorToolName(message.name, message.args);
      if (message.status === "running") {
        const display = buildCursorToolDisplay(resolvedName, resolvedArgs);
        events.push({
          type: "tool_start",
          name: resolvedName,
          arguments: JSON.stringify(resolvedArgs),
          callId: message.call_id,
          display,
        });
      } else if (message.status === "completed" || message.status === "error") {
        const isError = message.status === "error";
        const text = normalizeCursorToolResult(message.result);
        const result = text.length > 0 ? text : isError ? "(tool returned an error with no message)" : "(no output)";
        const structured = extractStructuredResult(message.result);
        const display = buildCursorToolDisplay(resolvedName, resolvedArgs);
        events.push({
          type: "tool_result",
          name: resolvedName,
          result,
          callId: message.call_id,
          isError,
          display,
          ...structured,
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
