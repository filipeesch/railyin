// Controllable stub worker for SubprocessCursorAdapter tests.
//
// Mirrors the wire protocol of src/bun/engine/cursor/worker.mjs but does NOT
// import @cursor/sdk — behaviour is driven entirely by the `prompt` field of
// `startRun` requests so each test can script a specific scenario.
//
// Recognised prompts:
//   "ready-delay-200"     — wait 200ms before sending the `ready` handshake
//   "emit-token-then-ok"  — emit one token event, then runDone ok
//   "crash-mid-run"       — emit one token event, then process.exit(1)
//   "tool-roundtrip"      — emit a toolCall, wait for toolResult, echo the
//                           result back as a token, then runDone ok
//
// Anything else: emit runDone ok immediately with no events.

import readline from "node:readline";

const send = (msg) => {
  process.stdout.write(JSON.stringify(msg) + "\n");
};

const pendingTools = new Map(); // callId -> resolve

async function handleStartRun(msg) {
  const { runId, prompt } = msg;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    if (prompt === "emit-token-then-ok") {
      send({ type: "event", runId, event: { type: "token", content: "hello" } });
      send({ type: "runDone", runId, status: "ok" });
      return;
    }

    if (prompt === "crash-mid-run") {
      send({ type: "event", runId, event: { type: "token", content: "about to crash" } });
      await sleep(20);
      process.exit(1);
    }

    if (prompt === "tool-roundtrip") {
      const callId = "call-fixture-1";
      const result = await new Promise((resolve, reject) => {
        pendingTools.set(callId, { resolve, reject });
        send({ type: "toolCall", runId, callId, toolName: "echo_tool", args: { msg: "ping" } });
      });
      send({ type: "event", runId, event: { type: "token", content: `tool-said:${result}` } });
      send({ type: "runDone", runId, status: "ok" });
      return;
    }

    // Default: nothing happens, just complete.
    send({ type: "runDone", runId, status: "ok" });
  } catch (err) {
    send({
      type: "runDone",
      runId,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleToolResult(msg) {
  const pending = pendingTools.get(msg.callId);
  if (!pending) return;
  pendingTools.delete(msg.callId);
  if (msg.error !== undefined) pending.resolve(`error:${msg.error}`);
  else pending.resolve(String(msg.result ?? ""));
}

function handleShutdown() {
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  switch (msg.type) {
    case "startRun":  handleStartRun(msg); break;
    case "toolResult": handleToolResult(msg); break;
    case "shutdown":  handleShutdown(); break;
  }
});

// Honor the explicit delay-ready scenario via env var so the first
// startRun is queued before the ready signal is emitted.
const readyDelayMs = Number(process.env.RAILYIN_TEST_READY_DELAY_MS ?? 0);
if (readyDelayMs > 0) {
  setTimeout(() => send({ type: "ready" }), readyDelayMs);
} else {
  send({ type: "ready" });
}
