/**
 * Cursor SDK adapter for Railyin integration.
 *
 * This adapter handles Cursor SDK agent creation and event streaming.
 * The Cursor SDK uses gRPC/Connect protocol for agent execution.
 */

import type { EngineEvent } from "../types.ts";
import { Http2SessionManager } from "@connectrpc/connect-node";
import { Agent, Cursor, type SDKCustomTool } from "@cursor/sdk";
import { translateCursorMessage } from "./events.ts";

// Workaround for an SDK transport bug under Bun + @cursor/sdk 1.0.18:
// the Cursor SDK uses Connect over HTTP/2 via @connectrpc/connect-node,
// whose Http2SessionManager opens HTTP/2 sessions with Node's default
// maxFrameSize of 16 KB. The Cursor backend sends larger frames during
// streaming runs, which triggers NGHTTP2_FRAME_SIZE_ERROR on first use.
//
// We apply two complementary patches:
//   1. A prototype setter on `http2SessionOptions` that merges
//      `settings.maxFrameSize` into the options Http2SessionManager passes
//      to `http2.connect()`. This is enough on Node.
//   2. A wrapper on `setState` that calls `session.settings()` on the live
//      session once it transitions to "ready". This is required on Bun
//      because Bun's `http2.connect()` silently drops the `settings` option;
//      calling `session.settings()` after connect correctly advertises the
//      higher limit to the server before the first request is opened.
const HTTP2_MAX_FRAME_SIZE = 15 * 1024 * 1024; // 15 MB
const PATCH_FLAG = Symbol.for("railyin/cursor/http2-frame-size-patched");
const sessionManagerProto = (Http2SessionManager as unknown as {
  prototype: Record<PropertyKey, unknown> & { setState?: (state: unknown) => void };
}).prototype;
if (!sessionManagerProto[PATCH_FLAG]) {
  Object.defineProperty(sessionManagerProto, "http2SessionOptions", {
    set(value: any) {
      const merged = {
        ...(value ?? {}),
        settings: { ...(value?.settings ?? {}), maxFrameSize: HTTP2_MAX_FRAME_SIZE },
      };
      Object.defineProperty(this, "http2SessionOptions", {
        value: merged,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    },
    get() { return undefined; },
    configurable: true,
  });

  const origSetState = sessionManagerProto.setState as (state: unknown) => void;
  if (typeof origSetState === "function") {
    sessionManagerProto.setState = function patchedSetState(state: any) {
      // For the "connecting" state, wrap the `conn` promise so it doesn't
      // resolve until the server has ACKed our updated SETTINGS frame. Both
      // gotoReady() (awaiting `this.s.conn`) and the inner `.then(value =>
      // setState(ready(value, ...)))` chain through this wrapped promise, so
      // the SDK cannot open a stream until the server has applied our new
      // maxFrameSize. Without this gate, the SDK's first request races our
      // SETTINGS frame and the server may still respond with frames larger
      // than the default 16 KB it thinks we advertised.
      if (state?.t === "connecting" && state.conn && typeof state.conn.then === "function") {
        const originalConn = state.conn as Promise<any>;
        state.conn = originalConn.then((session) => new Promise<any>((resolve) => {
          if (!session || typeof session.settings !== "function" || session.destroyed || session.closed) {
            resolve(session);
            return;
          }
          try {
            session.settings({ maxFrameSize: HTTP2_MAX_FRAME_SIZE }, () => resolve(session));
          } catch {
            resolve(session);
          }
        }));
      }
      return origSetState.call(this, state);
    };
  }

  sessionManagerProto[PATCH_FLAG] = true;
}

export interface CursorSdkAdapter {
  run(config: CursorRunConfig): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  listModels(workingDirectory: string): Promise<CursorSdkModelInfo[]>;
  listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>>;
  shutdownAll?(): Promise<void>;
}

export interface CursorSdkModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportsThinking?: boolean;
}

export interface CursorRunConfig {
  executionId: number;
  taskId: number;
  prompt: string;
  workingDirectory: string;
  model?: string;
  systemInstructions?: string;
  taskContext?: { title: string; description?: string };
  signal?: AbortSignal;
  sessionId: string;
  /**
   * Custom tools to register with the Cursor agent (keyed by tool name).
   * Cursor's built-in tools (Read/Edit/Shell/Grep) remain available alongside
   */
  customTools?: Record<string, SDKCustomTool>;
  /**
   * Optional raw-message hook so the engine can persist SDK messages to
   * model_raw_messages for later inspection.
   */
  onRawMessage?: (message: unknown) => void;
}

export interface CursorAdapterOptions {
  /** Cursor API key. Falls back to `process.env.CURSOR_API_KEY` when omitted. */
  apiKey?: string;
}

export function createDefaultCursorSdkAdapter(options: CursorAdapterOptions = {}): CursorSdkAdapter {
  return new DefaultCursorSdkAdapter(options);
}

class DefaultCursorSdkAdapter implements CursorSdkAdapter {
  private readonly apiKey?: string;

  constructor(options: CursorAdapterOptions = {}) {
    this.apiKey = options.apiKey;
  }

  private resolveApiKey(): string | undefined {
    return this.apiKey ?? process.env.CURSOR_API_KEY;
  }

  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    const { workingDirectory, model, prompt, signal, customTools, onRawMessage } = config;

    const agentOptions: any = {
      model: model ? { id: model } : undefined,
      apiKey: this.resolveApiKey(),
      local: {
        cwd: workingDirectory,
        ...(customTools ? { customTools } : {}),
      },
    };

    const session = await Agent.create(agentOptions);
    const run = await session.send(prompt);

    // Forward external aborts to the Run. Stream iteration ends naturally once
    // the run reports cancelled.
    const onAbort = () => { run.cancel().catch(() => {}); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      for await (const message of run.stream()) {
        onRawMessage?.(message);
        const events = translateCursorMessage(message);
        for (const event of events) {
          yield event;
        }
      }
      // The Cursor SDK does not surface error details through stream() — a
      // failing run just emits a bare `status: ERROR`. wait() resolves with a
      // RunResult that carries the actual reason in `result`.
      if (!signal?.aborted) {
        try {
          const result = await run.wait();
          if (result.status === "error") {
            console.error("[cursor] run failed:", result.result ?? "(no detail)", "id:", result.id);
            yield { type: "error", message: result.result ?? "Cursor agent run failed with no detail", fatal: true };
          } else {
            yield { type: "done" };
          }
        } catch (waitErr) {
          console.error("[cursor] run.wait() threw:", waitErr);
          yield { type: "done" };
        }
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      await run.cancel().catch(() => {});
      session.close();
    }
  }

  async cancel(executionId: number): Promise<void> {
    // Cancel handled via run.cancel() in the adapter
  }

  async listModels(_workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      console.warn("[cursor] listModels: no api_key configured and CURSOR_API_KEY is not set; returning empty model list");
      return [];
    }
    const models = await Cursor.models.list({ apiKey });
    return models.map((m) => ({
      value: m.id,
      displayName: m.displayName,
      description: m.description,
    }));
  }

  async listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    return [];
  }

  async shutdownAll(): Promise<void> {
    // No cleanup needed for in-process SDK
  }
}
