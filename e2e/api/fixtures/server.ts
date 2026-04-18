/**
 * server.ts — Fixture that starts a fresh Bun server for API tests.
 *
 * Spawns `bun src/bun/index.ts` with RAILYN_FORCE_MEMORY_DB=1 and a temp
 * config dir, reads the port from stdout, and provides a typed `request()`
 * helper for making API calls.
 *
 * Usage:
 *   import { startServer } from "./server";
 *
 *   const server = await startServer();
 *   const response = await server.request("boards.list", {});
 *   await server.shutdown();
 */

import { spawn } from "bun";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RailynAPI } from "@shared/rpc-types";

const ROOT = new URL("../../", import.meta.url).pathname;

function tmpdir_path(prefix: string) {
    return mkdtempSync(join(tmpdir(), prefix));
}

function writeTestConfig(configDir: string) {
    mkdirSync(join(configDir, "workflows"), { recursive: true });

    writeFileSync(join(configDir, "workspace.yaml"), `
id: 1
key: test-ws
name: Test Workspace
ai:
  baseUrl: http://localhost
  apiKey: fake
  model: fake/test
  provider: fake
worktreeBasePath: ${join(configDir, "worktrees")}
enableThinking: false
`);

    writeFileSync(join(configDir, "providers.yaml"), `
providers: []
`);

    writeFileSync(join(configDir, "workflows", "default.yaml"), `
id: default
name: Default
columns:
  - id: backlog
    label: Backlog
  - id: plan
    label: Plan
  - id: in_progress
    label: In Progress
  - id: in_review
    label: In Review
  - id: done
    label: Done
`);
}

export interface TestServer {
    baseUrl: string;
    debugUrl: string;
    /** Type-safe API call */
    request<M extends keyof RailynAPI>(
        method: M,
        params: RailynAPI[M]["params"],
    ): Promise<RailynAPI[M]["response"]>;
    shutdown(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
    const configDir = tmpdir_path("railyn-test-config-");
    writeTestConfig(configDir);

    const proc = spawn({
        cmd: ["bun", "src/bun/index.ts"],
        cwd: ROOT,
        env: {
            ...process.env,
            RAILYN_FORCE_MEMORY_DB: "1",
            RAILYN_FORCE_DEBUG: "1",
            RAILYN_DEV_CONFIG_DIR: configDir,
        },
        stdout: "pipe",
        stderr: "pipe",
    });

    // Read stdout until we see "listening on" and "DEBUG_PORT="
    let mainPort = 0;
    let debugPort = 0;

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 15_000);
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        async function read() {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    const mainMatch = buf.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
                    if (mainMatch) mainPort = parseInt(mainMatch[1]);

                    const debugMatch = buf.match(/DEBUG_PORT=(\d+)/);
                    if (debugMatch) debugPort = parseInt(debugMatch[1]);

                    if (mainPort > 0 && debugPort > 0) {
                        clearTimeout(timeout);
                        resolve();
                        return;
                    }
                }
            } catch (e) {
                reject(e);
            }
        }
        read();
    });

    const baseUrl = `http://127.0.0.1:${mainPort}`;
    const debugUrl = `http://127.0.0.1:${debugPort}`;

    async function request<M extends keyof RailynAPI>(
        method: M,
        params: RailynAPI[M]["params"],
    ): Promise<RailynAPI[M]["response"]> {
        const res = await fetch(`${baseUrl}/api/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(params),
        });
        if (!res.ok) {
            throw new Error(`${method} failed ${res.status}: ${await res.text()}`);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) return undefined as RailynAPI[M]["response"];
        return (res.json() as unknown) as RailynAPI[M]["response"];
    }

    async function shutdown() {
        await fetch(`${debugUrl}/shutdown`).catch(() => { });
        await proc.exited;
    }

    return { baseUrl, debugUrl, request, shutdown };
}
