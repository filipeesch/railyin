#!/usr/bin/env bun
/**
 * Dev server launcher. Spawns vite build --watch and the bun server in parallel.
 *
 * Usage:
 *   bun run dev                              # port 3000, real DB
 *   bun run dev -- --port=3001              # custom port
 *   bun run dev -- --memory-db              # in-memory SQLite
 *   bun run dev -- --port=3001 --memory-db  # both
 */

const argv = process.argv.slice(2);
const portArg = argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "3000";
const memoryDb = argv.includes("--memory-db");

const cwd = process.cwd();

const vite = Bun.spawn(["bun", "x", "vite", "build", "--watch"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});

const server = Bun.spawn(
  [
    "bun",
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
