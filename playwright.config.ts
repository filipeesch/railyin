import { defineConfig, devices } from "@playwright/test";

/**
 * UI tests run against the statically built frontend (dist/).
 * The backend is fully mocked — page.route() intercepts all /api/* calls
 * and page.routeWebSocket() intercepts the /ws push channel.
 *
 * No server is started. Run `bun run build` before running tests.
 */
export default defineConfig({
    testDir: "e2e/ui",
    testMatch: "**/*.spec.ts",
    fullyParallel: true,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 4 : undefined,
    reporter: [["list"], ["html", { open: "never" }]],

    use: {
        // Vite preview serves dist/ — started by webServer below
        baseURL: "http://localhost:4173",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },

    // Serve the built dist/ with `vite preview` before running tests.
    // Tests themselves mock the backend — no Bun server needed.
    webServer: {
        command: "npx vite preview --port 4173",
        port: 4173,
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
