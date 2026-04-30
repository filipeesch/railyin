/**
 * Vitest setup shim: provides Bun.serve() and Bun.file() as Node.js equivalents.
 *
 * This file is loaded via `setupFiles` in vitest.backend.config.ts BEFORE any
 * test module is evaluated, so `globalThis.Bun` is available when production
 * modules like resolve-file-attachments.ts or test files call Bun.* APIs.
 */
import { createServer } from "node:http";
import { readFile, writeFile as writeFileAsync, access, constants } from "node:fs/promises";
import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import type { AddressInfo } from "node:net";

type FetchHandler = (req: Request) => Response | Promise<Response>;

interface BunServer {
  readonly port: number;
  stop(force?: boolean): void;
}

function serve(options: { port?: number; fetch: FetchHandler }): BunServer {
  const server = createServer(async (incomingReq, outgoingRes) => {
    // Collect request body
    const chunks: Buffer[] = [];
    for await (const chunk of incomingReq) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const host = incomingReq.headers.host ?? "localhost";
    const url = `http://${host}${incomingReq.url}`;
    const headers = new Headers(
      Object.entries(incomingReq.headers).flatMap(([k, v]) =>
        v == null ? [] : Array.isArray(v) ? v.map((vi) => [k, vi] as [string, string]) : [[k, v] as [string, string]]
      )
    );
    const req = new Request(url, {
      method: incomingReq.method!,
      headers,
      body: body.length > 0 ? body : undefined,
    });

    const response = await options.fetch(req);
    const respBody = await response.arrayBuffer();
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
    outgoingRes.writeHead(response.status, respHeaders);
    outgoingRes.end(Buffer.from(respBody));
  });

  // listen(0) binds immediately; address() is valid synchronously
  server.listen(options.port ?? 0);

  return {
    get port() {
      return ((server.address() as AddressInfo) ?? { port: 0 }).port;
    },
    stop(_force?: boolean) {
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      server.close();
    },
  };
}

function file(path: string) {
  return {
    text: () => readFile(path, "utf-8"),
    json: async () => JSON.parse(await readFile(path, "utf-8")),
    arrayBuffer: async () => {
      const buf = await readFile(path);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
    exists: async () => {
      try {
        await access(path, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function write(path: string, content: string | Uint8Array | ArrayBuffer): Promise<number> {
  const data = typeof content === "string" ? content : Buffer.from(content as ArrayBuffer);
  return writeFileAsync(path, data).then(() => (typeof content === "string" ? Buffer.byteLength(content) : (content as { byteLength: number }).byteLength));
}

function which(cmd: string, options?: { PATH?: string }): string | null {
  try {
    const env = options?.PATH ? { ...process.env, PATH: options.PATH } : process.env;
    const result = execFileSync("which", [cmd], { env, encoding: "utf-8" }).trim();
    return result || null;
  } catch {
    return null;
  }
}


import { createHash } from "node:crypto";

class CryptoHasher {
  private _hash: ReturnType<typeof createHash>;
  constructor(algo: string) { this._hash = createHash(algo); }
  update(data: string | ArrayBuffer | Buffer): this {
    if (typeof data === "string") this._hash.update(data, "utf-8");
    else this._hash.update(Buffer.from(data as ArrayBuffer));
    return this;
  }
  digest(encoding: "hex" | "base64"): string { return this._hash.digest(encoding); }
}

function spawn(args: string[], options?: { cwd?: string; stdout?: string; stderr?: string; stdin?: Uint8Array | "pipe" | "inherit" | "ignore"; env?: Record<string, string> }) {
  const stdinArg = options?.stdin;
  const stdinMode = stdinArg instanceof Uint8Array ? "pipe" : (stdinArg ?? "ignore");
  const proc = nodeSpawn(args[0], args.slice(1), {
    cwd: options?.cwd,
    env: options?.env ? { ...process.env, ...options.env } : process.env,
    stdio: [
      stdinMode,
      options?.stdout === "pipe" ? "pipe" : "inherit",
      options?.stderr === "pipe" ? "pipe" : "inherit",
    ],
  });

  if (stdinArg instanceof Uint8Array && proc.stdin) {
    proc.stdin.write(Buffer.from(stdinArg));
    proc.stdin.end();
  }

  // Eagerly collect stdout/stderr into buffers so data is never lost when
  // reading after `await exited` (Readable.toWeb() can drop data if the
  // underlying stream already ended before the web consumer starts).
  function collectStream(stream: import("node:stream").Readable | null): Promise<Buffer> {
    if (!stream) return Promise.resolve(Buffer.alloc(0));
    return new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", () => resolve(Buffer.concat(chunks)));
    });
  }

  const stdoutBuf = collectStream(proc.stdout);
  const stderrBuf = collectStream(proc.stderr);

  let _exitCode: number | null = null;
  const exitedPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => {
      _exitCode = code ?? 0;
      resolve(_exitCode);
    });
  });

  function bufToReadableStream(bufPromise: Promise<Buffer>): ReadableStream {
    return new ReadableStream({
      async start(controller) {
        const data = await bufPromise;
        if (data.length > 0) controller.enqueue(data);
        controller.close();
      },
    });
  }

  return {
    get exited() { return exitedPromise; },
    get exitCode() { return _exitCode; },
    get stdout() { return options?.stdout === "pipe" ? bufToReadableStream(stdoutBuf) : null; },
    get stderr() { return options?.stderr === "pipe" ? bufToReadableStream(stderrBuf) : null; },
  };
}

(globalThis as Record<string, unknown>).Bun = { serve, file, write, which, spawn, CryptoHasher };
