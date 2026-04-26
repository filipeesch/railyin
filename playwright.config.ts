import { defineConfig, devices } from "@playwright/test";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

/**
 * UI tests run against the statically built frontend (dist/).
 * The backend is fully mocked — page.route() intercepts all /api/* calls
 * and page.routeWebSocket() intercepts the /ws push channel.
 *
 * No server is started. Run `bun run build` before running tests.
 *
 * Port is derived from the working directory path so parallel runs from
 * different worktrees never share a Vite preview server and serve stale builds.
 */

// Hash the absolute project root to a port in the range 4100–4999.
// Different worktrees resolve to different ports, preventing a stale Vite server
// from another worktree being reused (reuseExistingServer only checks the port).
const __dirname = dirname(fileURLToPath(import.meta.url));
const portSeed = createHash("sha256").update(__dirname).digest("hex");
const PORT = 4100 + (parseInt(portSeed.slice(0, 4), 16) % 900);

export default defineConfig({
    testDir: "e2e/ui",
    testMatch: "**/*.spec.ts",
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 4 : undefined,
    reporter: [["list"], ["html", { open: "never" }]],

    use: {
        // Vite preview serves dist/ — started by webServer below
        baseURL: `http://localhost:${PORT}`,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },

    // Serve the built dist/ with `vite preview` before running tests.
    // Tests themselves mock the backend — no Bun server needed.
    webServer: {
        command: `npx vite preview --port ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
