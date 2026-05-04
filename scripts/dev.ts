#!/usr/bin/env bun
/**
 * Dev server launcher. Spawns vite build --watch and the bun server in parallel.
 * Defaults to in-memory SQLite for safety. Use --real-db to persist data.
 *
 * Usage:
 *   bun run dev                              # port 3000, in-memory SQLite (safe default)
 *   bun run dev -- --port=3001              # custom port, in-memory SQLite
 *   bun run dev -- --real-db               # use real persistent DB (production data)
 *   bun run dev -- --port=3001 --real-db   # both
 */

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3000";
const memoryDb = !argv.includes("--real-db");

const cwd = process.cwd().replace(/\\/g, "/");
const bunBin = process.execPath;

const vite = Bun.spawn([bunBin, "x", "vite", "build", "--watch"], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
});

const server = Bun.spawn(
    [
        bunBin,
        "--watch",
        "--define", "__RAILYN_FORCE_DEBUG__=false",
        "--define", `__RAILYN_FORCE_MEMORY_DB__=${memoryDb}`,
        "--define", `__RAILYN_DEV_CONFIG_DIR__="${cwd}/config"`,
        "src/bun/index.ts",
        `--port=${portArg}`,
    ],
    {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
    },
);

// Forward SIGINT/SIGTERM to both child processes
const cleanup = () => {
    vite.kill();
    server.kill();
    process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Exit if either child exits unexpectedly
await Promise.race([vite.exited, server.exited]);
cleanup();
