/**
 * Bun-side adapter that delegates @cursor/sdk work to a Node subprocess.
 *
 * One long-lived Node worker per CursorAdapterOptions/process. It is spawned
 * lazily on the first call and kept alive for the Bun process lifetime.
 * Crashes are detected; subsequent calls will respawn it.
 *
 * The adapter speaks line-delimited JSON over stdio with worker.mjs (see
 * worker-protocol.ts for the wire types). Custom-tool callbacks stay on the
 * Bun side — when the worker reports a `toolCall`, we look up the
 * corresponding SDKCustomTool from the active run and invoke its execute(),
 * then forward the result back as `toolResult`.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { EngineEvent } from "../types.ts";
import type { SDKCustomTool } from "@cursor/sdk";
import type {
  BunToWorker,
  StartRunRequest,
  ToolSchema,
  WorkerToBun,
} from "./worker-protocol.ts";
import type {
  CursorAdapterOptions,
  CursorRunConfig,
  CursorSdkAdapter,
  CursorSdkModelInfo,
} from "./adapter.ts";

const DEFAULT_WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "worker.mjs");

interface ActiveRun {
  runId: string;
  customTools: Record<string, SDKCustomTool>;
  onRawMessage?: (message: unknown) => void;
  pushEvent: (event: EngineEvent | null) => void; // null = end of stream
  pushError: (err: Error) => void;
}

interface PendingResponse {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class SubprocessCursorAdapter implements CursorSdkAdapter {
  private readonly apiKey?: string;
  private readonly workerScriptPath: string;
  private worker: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private workerReady: Promise<void> | null = null;
  private readonly runs = new Map<string, ActiveRun>();
  private readonly pending = new Map<string, PendingResponse>();
  private shuttingDown = false;

  constructor(options: CursorAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.workerScriptPath = options.workerScriptPath ?? DEFAULT_WORKER_SCRIPT;
  }

  private resolveApiKey(): string | undefined {
    return this.apiKey ?? process.env.CURSOR_API_KEY;
  }

  private ensureWorker(): Promise<void> {
    if (this.worker && !this.worker.killed && this.workerReady) {
      return this.workerReady;
    }

    const nodeBin = process.env.RAILYIN_CURSOR_NODE ?? "node";
    const child = spawn(nodeBin, [this.workerScriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    }) as ChildProcessByStdio<Writable, Readable, Readable>;

    this.worker = child;
    this.workerReady = new Promise<void>((resolve, reject) => {
      let ready = false;
      const rl = readline.createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        if (!line.trim()) return;
        let msg: WorkerToBun;
        try { msg = JSON.parse(line) as WorkerToBun; } catch {
          console.error("[cursor-worker] malformed line:", line);
          return;
        }
        if (msg.type === "ready") {
          ready = true;
          resolve();
          return;
        }
        this.handleWorkerMessage(msg);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[cursor-worker stderr] ${chunk.toString("utf8")}`);
      });
      child.on("exit", (code, signal) => {
        const reason = `worker exited (code=${code}, signal=${signal})`;
        if (!this.shuttingDown) console.error(`[cursor] ${reason}`);
        this.worker = null;
        this.workerReady = null;
        const fail = new Error(reason);
        if (!ready) reject(fail);
        for (const { reject: rej } of this.pending.values()) rej(fail);
        this.pending.clear();
        for (const run of this.runs.values()) {
          run.pushError(fail);
          run.pushEvent(null);
        }
        this.runs.clear();
      });
      child.on("error", (err) => {
        if (!ready) reject(err);
      });
    });

    return this.workerReady;
  }

  private send(msg: BunToWorker): void {
    if (!this.worker) throw new Error("worker not running");
    this.worker.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleWorkerMessage(msg: WorkerToBun): void {
    switch (msg.type) {
      case "response": {
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        this.pending.delete(msg.requestId);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
        return;
      }
      case "event": {
        const run = this.runs.get(msg.runId);
        run?.pushEvent(msg.event);
        return;
      }
      case "rawMessage": {
        const run = this.runs.get(msg.runId);
        run?.onRawMessage?.(msg.message);
        return;
      }
      case "toolCall": {
        this.handleToolCall(msg.runId, msg.callId, msg.toolName, msg.args);
        return;
      }
      case "runDone": {
        const run = this.runs.get(msg.runId);
        if (!run) return;
        if (msg.status === "error") {
          run.pushEvent({
            type: "error",
            message: msg.detail ?? "Cursor agent run failed with no detail",
            fatal: true,
          });
        }
        run.pushEvent(null);
        return;
      }
      case "log": {
        const fn = msg.level === "error" ? console.error : msg.level === "warn" ? console.warn : console.log;
        fn(`[cursor-worker] ${msg.message}`);
        return;
      }
    }
  }

  private async handleToolCall(runId: string, callId: string, toolName: string, args: unknown): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      this.send({ type: "toolResult", callId, error: `unknown run ${runId}` });
      return;
    }
    const tool = run.customTools[toolName];
    if (!tool) {
      this.send({ type: "toolResult", callId, error: `unknown tool ${toolName}` });
      return;
    }
    try {
      const result = await tool.execute(args as any, {} as any);
      this.send({ type: "toolResult", callId, result });
    } catch (err) {
      this.send({
        type: "toolResult",
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private request<T>(msg: Omit<BunToWorker, "requestId"> & { requestId: string }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(msg.requestId, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.send(msg as BunToWorker);
    });
  }

  /* ─── CursorSdkAdapter API ───────────────────────────────────────── */

  async *run(config: CursorRunConfig): AsyncIterable<EngineEvent> {
    await this.ensureWorker();
    const runId = randomUUID();

    const queue: (EngineEvent | null)[] = [];
    const waiters: Array<(v: EngineEvent | null) => void> = [];
    const pushEvent = (event: EngineEvent | null) => {
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else queue.push(event);
    };
    let pendingError: Error | null = null;
    const pushError = (err: Error) => {
      pendingError = err;
      pushEvent(null);
    };

    const toolSchemas: ToolSchema[] = Object.entries(config.customTools ?? {}).map(
      ([name, tool]) => ({
        name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      }),
    );

    this.runs.set(runId, {
      runId,
      customTools: config.customTools ?? {},
      onRawMessage: config.onRawMessage,
      pushEvent,
      pushError,
    });

    const onAbort = () => {
      this.send({ type: "cancelRun", runId });
    };
    if (config.signal) {
      if (config.signal.aborted) onAbort();
      else config.signal.addEventListener("abort", onAbort, { once: true });
    }

    const startMsg: StartRunRequest = {
      type: "startRun",
      runId,
      apiKey: this.resolveApiKey(),
      workingDirectory: config.workingDirectory,
      model: config.model,
      prompt: config.prompt,
      toolSchemas,
      ...(config.agentId ? { agentId: config.agentId } : {}),
    };
    this.send(startMsg);

    try {
      while (true) {
        let next: EngineEvent | null;
        if (queue.length > 0) {
          next = queue.shift()!;
        } else {
          next = await new Promise<EngineEvent | null>((resolve) => waiters.push(resolve));
        }
        if (next === null) {
          if (pendingError) throw pendingError;
          break;
        }
        yield next;
      }
      if (!config.signal?.aborted) yield { type: "done" };
    } finally {
      if (config.signal) config.signal.removeEventListener("abort", onAbort);
      this.runs.delete(runId);
    }
  }

  async cancel(_executionId: number): Promise<void> {
    // Cancel is driven by the AbortSignal passed into run(); no separate path.
  }

  async listModels(_workingDirectory: string): Promise<CursorSdkModelInfo[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      console.warn("[cursor] listModels: no api_key configured and CURSOR_API_KEY is not set; returning empty model list");
      return [];
    }
    await this.ensureWorker();
    const requestId = randomUUID();
    return await this.request<CursorSdkModelInfo[]>({
      type: "listModels",
      requestId,
      apiKey,
    } as any);
  }

  async listCommands(_workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    return [];
  }

  async shutdownAll(): Promise<void> {
    if (!this.worker) return;
    this.shuttingDown = true;
    try {
      this.send({ type: "shutdown" });
    } catch {}
    this.worker.kill("SIGTERM");
    this.worker = null;
    this.workerReady = null;
  }
}
