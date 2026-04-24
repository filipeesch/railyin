/**
 * rpc.ts — HTTP + WebSocket transport layer for the frontend.
 *
 * api(method, params) — POST /api/<method> with JSON body, returns typed response.
 *
 * WebSocket push: the WS connection to /ws receives server-sent events
 * (stream.token, stream.event, stream.error, task.updated, message.new, workflow.reloaded).
 * The connection reconnects automatically with exponential backoff.
 */

import type { RailynAPI, PushMessage, StreamToken, StreamError, StreamEvent, Task, ConversationMessage, CodeRef, ChatSession } from "@shared/rpc-types";

// ─── Server base URL ──────────────────────────────────────────────────────────
// In dev and production the frontend is served by the same Bun server,
// so we can always use the current page origin.
const BASE = window.location.origin;

// ─── API fetch ────────────────────────────────────────────────────────────────

export async function api<M extends keyof RailynAPI>(
  method: M,
  params: RailynAPI[M]["params"],
): Promise<RailynAPI[M]["response"]> {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`api(${method}) failed ${res.status}: ${text}`);
  }
  // Handlers that return void produce an empty body or null
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as RailynAPI[M]["response"];
  return res.json() as Promise<RailynAPI[M]["response"]>;
}

// ─── Push callbacks (registered lazily from App.vue) ─────────────────────────

let _onStreamToken: (payload: StreamToken) => void = () => { };
let _onStreamError: (payload: StreamError) => void = () => { };
let _onStreamEvent: (payload: StreamEvent) => void = () => { };
let _onTaskUpdated: (task: Task) => void = () => { };
let _onNewMessage: (message: ConversationMessage) => void = () => { };
let _onWorkflowReloaded: () => void = () => { };
let _onCodeRef: (ref: CodeRef) => void = () => { };
let _onChatSessionUpdated: (session: ChatSession) => void = () => { };
let _onChatSessionCreated: (session: ChatSession) => void = () => { };

export function onStreamToken(cb: (payload: StreamToken) => void) { _onStreamToken = cb; }
export function onStreamError(cb: (payload: StreamError) => void) { _onStreamError = cb; }
export function onStreamEventMessage(cb: (payload: StreamEvent) => void) { _onStreamEvent = cb; }
export function onTaskUpdated(cb: (task: Task) => void) { _onTaskUpdated = cb; }
export function onNewMessage(cb: (message: ConversationMessage) => void) { _onNewMessage = cb; }
export function onWorkflowReloaded(cb: () => void) { _onWorkflowReloaded = cb; }
export function onCodeRef(cb: (ref: CodeRef) => void) { _onCodeRef = cb; }
export function onChatSessionUpdated(cb: (session: ChatSession) => void) { _onChatSessionUpdated = cb; }
export function onChatSessionCreated(cb: (session: ChatSession) => void) { _onChatSessionCreated = cb; }

// ─── WebSocket push connection ────────────────────────────────────────────────

const WS_URL = `${BASE.replace(/^http/, "ws")}/ws`;
const WS_MAX_BACKOFF_MS = 30_000;

let _wsRetries = 0;
let _wsTimer: ReturnType<typeof setTimeout> | null = null;

function connectWs(): void {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    _wsRetries = 0;
  };

  ws.onmessage = (evt: MessageEvent) => {
    let msg: PushMessage;
    try {
      msg = JSON.parse(evt.data as string) as PushMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "stream.token": _onStreamToken(msg.payload); break;
      case "stream.error": _onStreamError(msg.payload); break;
      case "stream.event": _onStreamEvent(msg.payload); break;
      case "task.updated": _onTaskUpdated(msg.payload); break;
      case "message.new": _onNewMessage(msg.payload); break;
      case "workflow.reloaded": _onWorkflowReloaded(); break;
      case "code.ref": _onCodeRef(msg.payload); break;
      case "chatSession.updated": _onChatSessionUpdated(msg.payload); break;
      case "chatSession.created": _onChatSessionCreated(msg.payload); break;
    }
  };

  ws.onclose = () => {
    const delay = Math.min(250 * 2 ** _wsRetries, WS_MAX_BACKOFF_MS);
    _wsRetries++;
    _wsTimer = setTimeout(connectWs, delay);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// Start the WS connection immediately
connectWs();

// Clean up on page unload
window.addEventListener("beforeunload", () => {
  if (_wsTimer !== null) clearTimeout(_wsTimer);
});
