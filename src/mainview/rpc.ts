// Typed wrapper around Electrobun's browser-side RPC.
// Electroview.defineRPC sets up the webview message handlers (stream.token, etc.)
// and electroview.rpc.request.xxx() is used to call bun-side handlers.

import { Electroview } from "electrobun/view";
import type { RailynRPCType, StreamToken, StreamError, Task, ConversationMessage } from "@shared/rpc-types";

// Mutable callbacks — registered lazily from App.vue once stores are ready.
let _onStreamToken: (payload: StreamToken) => void = () => {};
let _onStreamError: (payload: StreamError) => void = () => {};
let _onTaskUpdated: (task: Task) => void = () => {};
let _onNewMessage: (message: ConversationMessage) => void = () => {};
let _onWorkflowReloaded: () => void = () => {};

const viewRpc = Electroview.defineRPC<RailynRPCType>({
  maxRequestTime: 120_000, // 2 minutes — LLM calls (compaction, model list) can be slow
  handlers: {
    requests: {},
    messages: {
      "stream.token": (payload) => _onStreamToken(payload),
      "stream.error": (payload) => _onStreamError(payload),
      "task.updated": (task) => _onTaskUpdated(task),
      "message.new": (message) => _onNewMessage(message),
      "workflow.reloaded": () => _onWorkflowReloaded(),
      "debug.log": () => {}, // direction is webview→bun only; this handler intentionally empty
    },
  },
});

export const electroview = new Electroview({ rpc: viewRpc });

export function onStreamToken(cb: (payload: StreamToken) => void) { _onStreamToken = cb; }
export function onStreamError(cb: (payload: StreamError) => void) { _onStreamError = cb; }
export function onTaskUpdated(cb: (task: Task) => void) { _onTaskUpdated = cb; }
export function onNewMessage(cb: (message: ConversationMessage) => void) { _onNewMessage = cb; }
export function onWorkflowReloaded(cb: () => void) { _onWorkflowReloaded = cb; }

/** Send a log line to bun's stdout (visible in the terminal running `bun run dev`). */
export function sendDebugLog(level: "log" | "warn" | "error", ...args: unknown[]) {
  const text = args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
    if (typeof a === "object" && a !== null) return JSON.stringify(a);
    return String(a);
  }).join(" ");
  electroview.rpc?.send["debug.log"]?.({ level, args: text });
}
