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
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { RailynAPI } from "@shared/rpc-types";

const ROOT = new URL("../../../", import.meta.url).pathname;
const RUNTIME_ROOT = join(ROOT, ".runtime");

function runtimePath(prefix: string) {
    mkdirSync(RUNTIME_ROOT, { recursive: true });
    const path = join(
        RUNTIME_ROOT,
        `${prefix}${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(path, { recursive: true });
    return path;
}

function writeTestConfig(runtimeDir: string) {
    const workspacesDir = join(runtimeDir, "workspaces");
    const workspaceDir = join(workspacesDir, "test-ws");
    const projectDir = join(runtimeDir, "project");
    mkdirSync(join(workspaceDir, "workflows"), { recursive: true });
    mkdirSync(join(workspaceDir, "worktrees"), { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, "README.md"), "test repo\n");
    execSync("git init", { cwd: projectDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: projectDir, stdio: "ignore" });
    execSync('git config user.name "Test User"', { cwd: projectDir, stdio: "ignore" });
    execSync("git add README.md && git commit -m init", { cwd: projectDir, stdio: "ignore" });
    try {
        execSync("git branch -M main", { cwd: projectDir, stdio: "ignore" });
    } catch { }

    writeFileSync(join(workspaceDir, "workspace.test.yaml"), `
name: Test Workspace
workspace_path: ${runtimeDir}
engine:
  type: copilot
  model: copilot/mock-model
projects:
  - key: test-ws
    name: Test Project
    project_path: project
    git_root_path: project
    default_branch: main
worktree_base_path: ${join(workspaceDir, "worktrees")}
enableThinking: false
`);

    writeFileSync(join(workspaceDir, "workflows", "default.yaml"), `
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

    return { workspacesDir, projectDir };
}

export interface TestServer {
    baseUrl: string;
    debugUrl: string;
    /** Absolute path to the test project directory (the main git repo, NOT a worktree) */
    projectDir: string;
    /** Type-safe API call */
    request<M extends keyof RailynAPI>(
        method: M,
        params: RailynAPI[M]["params"],
    ): Promise<RailynAPI[M]["response"]>;
    shutdown(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
    const runtimeDir = runtimePath("api-");
    const { workspacesDir, projectDir } = writeTestConfig(runtimeDir);

    const proc = spawn({
        cmd: [
            "bun",
            "--define",
            "__RAILYN_FORCE_DEBUG__=false",
            "--define",
            "__RAILYN_FORCE_MEMORY_DB__=false",
            "--define",
            '__RAILYN_DEV_CONFIG_DIR__=""',
            "src/bun/index.ts",
            "--memory-db",
            "--port=0",
        ],
        cwd: ROOT,
        env: {
            ...process.env,
            RAILYN_DEBUG: "1",
            RAILYN_WORKSPACES_DIR: workspacesDir,
            RAILYN_TEST_EXECUTION_ENGINE: "mock",
        },
        stdout: "pipe",
        stderr: "pipe",
    });

    // Read stdout until we see "listening on" and "DEBUG_PORT="
    let mainPort = 0;
    let debugPort = 0;
    let stderr = "";

    const stderrReader = proc.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    void (async () => {
        while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;
            stderr += stderrDecoder.decode(value, { stream: true });
        }
    })();

    try {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Server startup timeout${stderr ? `\n${stderr}` : ""}`));
            }, 15_000);
            const reader = proc.stdout.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let settled = false;

            void proc.exited.then((code) => {
                if (settled || (mainPort > 0 && debugPort > 0)) return;
                settled = true;
                clearTimeout(timeout);
                reject(new Error(`Server exited before startup (code ${code})${stderr ? `\n${stderr}` : ""}`));
            });

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
                            settled = true;
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
    } catch (error) {
        rmSync(runtimeDir, { recursive: true, force: true });
        throw error;
    }

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
        try {
            await fetch(`${debugUrl}/shutdown`).catch(() => { });
            await proc.exited;
        } finally {
            rmSync(runtimeDir, { recursive: true, force: true });
        }
    }

    return { baseUrl, debugUrl, request, shutdown, projectDir };
}
