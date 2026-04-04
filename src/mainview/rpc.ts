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

const viewRpc = Electroview.defineRPC<RailynRPCType>({
  maxRequestTime: 120_000, // 2 minutes — LLM calls (compaction, model list) can be slow
  handlers: {
    requests: {},
    messages: {
      "stream.token": (payload) => _onStreamToken(payload),
      "stream.error": (payload) => _onStreamError(payload),
      "task.updated": (task) => _onTaskUpdated(task),
      "message.new": (message) => _onNewMessage(message),
    },
  },
});

export const electroview = new Electroview({ rpc: viewRpc });

export function onStreamToken(cb: (payload: StreamToken) => void) { _onStreamToken = cb; }
export function onStreamError(cb: (payload: StreamError) => void) { _onStreamError = cb; }
export function onTaskUpdated(cb: (task: Task) => void) { _onTaskUpdated = cb; }
export function onNewMessage(cb: (message: ConversationMessage) => void) { _onNewMessage = cb; }
