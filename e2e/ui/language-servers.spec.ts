/**
 * language-servers.spec.ts — UI tests for the Language Servers tab in SetupView.
 *
 * Suites:
 *   LS-N  — Tab navigation (project row badge + shortcut)
 *   LS-S  — Scan for languages
 *   LS-I  — Install language server (not yet installed)
 *   LS-A  — Already installed: Add to workspace config
 *   LS-C  — inConfig=true: shows "In workspace config" without Add button
 *   LS-P  — Pre-configured servers shown on tab load
 */

import { test, expect } from "./fixtures";
import { makeWorkspace, makeProject, WORKSPACE_KEY } from "./fixtures/mock-data";
import { goToSetup } from "./fixtures/setup-helpers";

// Enforce a wide enough viewport to ensure all 5 tabs are visible without clipping.
// Serial mode prevents shared mock-server state from leaking between parallel workers.
test.use({ viewport: { width: 1024, height: 768 } });
test.describe.configure({ mode: "serial" });

const MODELS = [
    {
        id: "copilot",
        models: [
            { id: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000, enabled: true },
        ],
    },
];

function makeTypescriptLang(overrides?: {
    alreadyInstalled?: boolean;
    inConfig?: boolean;
    installOptions?: Array<{ label: string; command: string }>;
}) {
    return {
        entry: {
            name: "TypeScript",
            detectionGlobs: ["**/*.ts"],
            serverName: "typescript-language-server",
            extensions: [".ts", ".tsx"],
            installOptions: overrides?.installOptions ?? [
                { label: "npm (global)", command: "npm install -g typescript-language-server typescript" },
            ],
        },
        alreadyInstalled: overrides?.alreadyInstalled ?? false,
        inConfig: overrides?.inConfig ?? false,
        installOptions: overrides?.installOptions ?? [
            { label: "npm (global)", command: "npm install -g typescript-language-server typescript" },
        ],
    };
}

async function goToLanguageServersTab(page: Parameters<typeof goToSetup>[0], api: Parameters<typeof goToSetup>[1]) {
    await goToSetup(page, api);
    await page.getByRole("tab", { name: "Language Servers" }).click();
}

// ─── Suite LS-N — Tab navigation ────────────────────────────────────────────

test.describe("LS-N — Language Servers tab navigation", () => {
    test("LS-N-1: Language Servers tab is visible and fully readable in setup", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        const lsTab = page.getByRole("tab", { name: "Language Servers" });
        await expect(lsTab).toBeVisible();
        // Verify the tab label is not clipped (full text is in the DOM)
        await expect(lsTab).toContainText("Language Servers");
        // All 5 tabs should be visible
        await expect(page.getByRole("tab", { name: "Workspace" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Projects" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Boards" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Models" })).toBeVisible();
    });

    test("LS-N-2: project row shows no-lang marker when no LSP detected for that project", async ({ page, api }) => {
        api.returns("models.list", MODELS).returns("projects.list", [makeProject()]);
        api.returns("workspace.getConfig", makeWorkspace());
        api.returns("lsp.detectLanguages", []);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        // After scan completes the spinner disappears and "—" is shown
        await expect(page.locator(".project-item__no-lang")).toBeVisible({ timeout: 5_000 });
    });

    test("LS-N-3: project row shows language badge when LSP detected for that project", async ({ page, api }) => {
        api.returns("models.list", MODELS).returns("projects.list", [makeProject()]);
        api.returns("workspace.getConfig", makeWorkspace());
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: true, inConfig: true })]);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        // After scan completes a green language badge appears
        await expect(page.locator(".project-item__lang-badge").filter({ hasText: "TypeScript" })).toBeVisible({ timeout: 5_000 });
    });

    test("LS-N-4: clicking the install button opens the install modal", async ({ page, api }) => {
        api.returns("models.list", MODELS).returns("projects.list", [makeProject()]);
        api.returns("workspace.getConfig", makeWorkspace());
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: false, inConfig: false })]);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        // Install button should appear with explicit label
        await expect(page.locator(".project-item__lang-install-btn").filter({ hasText: "Install TypeScript LSP" })).toBeVisible({ timeout: 5_000 });
        await page.locator(".project-item__lang-install-btn").filter({ hasText: "Install TypeScript LSP" }).click();
        // Install modal should open
        await expect(page.getByRole("dialog", { name: /set up typescript/i })).toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite LS-S — Scan for languages ────────────────────────────────────────

test.describe("LS-S — Scan for languages", () => {
    test("LS-S-1: Scan button is visible on Language Servers tab", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToLanguageServersTab(page, api);
        await expect(page.getByRole("button", { name: /scan for languages/i })).toBeVisible();
    });

    test("LS-S-2: scanning with no results shows 'No supported languages detected'", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("lsp.detectLanguages", []);
        api.returns("projects.list", [makeProject()]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".ls-empty-msg")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".ls-empty-msg")).toContainText(/no supported languages detected/i);
    });

    test("LS-S-3: scanning with results shows LspSetupPrompt with language cards", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang()]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".lsp-lang-card__name").filter({ hasText: "TypeScript" })).toBeVisible();
    });

    test("LS-S-4: lsp.detectLanguages is called with workspace path", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        const detectCalls = api.capture("lsp.detectLanguages", []);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".ls-empty-msg")).toBeVisible({ timeout: 3_000 });
        expect(detectCalls.length).toBeGreaterThan(0);
        expect(detectCalls[0]).toMatchObject({ workspaceKey: WORKSPACE_KEY });
    });
});

// ─── Suite LS-I — Install language server ────────────────────────────────────

test.describe("LS-I — Install language server", () => {
    test("LS-I-1: not-installed language shows Install button and option selector", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: false })]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".lsp-lang-card__badge").filter({ hasText: "Not installed" })).toBeVisible();
        await expect(page.getByRole("button", { name: /^install$/i })).toBeVisible();
    });

    test("LS-I-2: successful install shows Done badge and output", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: false })]);
        api.returns("lsp.runInstall", { success: true, output: "added 1 package" });
        api.returns("lsp.addToConfig", { ok: true });
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.getByRole("button", { name: /^install$/i })).toBeVisible({ timeout: 3_000 });
        await page.getByRole("button", { name: /^install$/i }).click();
        await expect(page.locator(".lsp-lang-card__badge").filter({ hasText: "Done" })).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".lsp-lang-card__output")).toContainText("added 1 package");
    });

    test("LS-I-3: failed install shows Error badge", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: false })]);
        api.returns("lsp.runInstall", { success: false, output: "permission denied" });
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.getByRole("button", { name: /^install$/i })).toBeVisible({ timeout: 3_000 });
        await page.getByRole("button", { name: /^install$/i }).click();
        await expect(page.locator(".lsp-lang-card__badge").filter({ hasText: "Error" })).toBeVisible({ timeout: 3_000 });
    });

    test("LS-I-4: no install options shows manual install note with Add to config button", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [
            makeTypescriptLang({ alreadyInstalled: false, installOptions: [] }),
        ]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card__no-options")).toBeVisible({ timeout: 3_000 });
        await expect(page.getByRole("button", { name: /add to workspace config/i })).toBeVisible();
    });
});

// ─── Suite LS-A — Already installed ─────────────────────────────────────────

test.describe("LS-A — Already installed language server", () => {
    test("LS-A-1: already-installed server shows Installed badge and Add to config button when not in config", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: true, inConfig: false })]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card__badge").filter({ hasText: "Installed" })).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".lsp-lang-card__installed-note")).toContainText("typescript-language-server is already on your PATH");
        await expect(page.getByRole("button", { name: /add to workspace config/i })).toBeVisible();
    });

    test("LS-A-2: clicking Add to config calls lsp.addToConfig and shows In workspace config", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: true, inConfig: false })]);
        const addCalls = api.capture("lsp.addToConfig", {});
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.getByRole("button", { name: /add to workspace config/i })).toBeVisible({ timeout: 3_000 });
        await page.getByRole("button", { name: /add to workspace config/i }).click();
        await expect(page.locator(".lsp-lang-card__ok")).toContainText("✓ In workspace config", { timeout: 3_000 });
        expect(addCalls.length).toBeGreaterThan(0);
        expect(addCalls[0]).toMatchObject({ languageServerName: "typescript-language-server", workspaceKey: WORKSPACE_KEY });
    });
});

// ─── Suite LS-C — Already in config ─────────────────────────────────────────

test.describe("LS-C — Server already in workspace config", () => {
    test("LS-C-1: inConfig=true shows In workspace config without Add button", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: true, inConfig: true })]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card__ok")).toContainText("✓ In workspace config", { timeout: 3_000 });
        await expect(page.getByRole("button", { name: /add to workspace config/i })).not.toBeVisible();
    });

    test("LS-C-2: Done button is enabled when all languages are in config or installed", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: true, inConfig: true })]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card")).toBeVisible({ timeout: 3_000 });
        await expect(page.getByRole("button", { name: /done/i })).toBeVisible();
    });

    test("LS-C-3: Skip button shown when not all are done, Done when all are done", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("projects.list", [makeProject()]);
        api.returns("lsp.detectLanguages", [makeTypescriptLang({ alreadyInstalled: false, inConfig: false })]);
        await goToLanguageServersTab(page, api);
        await page.getByRole("button", { name: /scan for languages/i }).click();
        await expect(page.locator(".lsp-lang-card")).toBeVisible({ timeout: 3_000 });
        await expect(page.getByRole("button", { name: /skip/i })).toBeVisible();
    });
});

// ─── Suite LS-E — Existing configured servers ─────────────────────────────────

test.describe("LS-E — Existing configured servers", () => {
    test("LS-E-1: Language Servers tab shows configured servers from workspace config", async ({ page, api }) => {
        const wsWithLsp = makeWorkspace({
            lsp: {
                servers: [
                    { name: "typescript-language-server", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts"] },
                ],
            },
        });
        api.returns("models.list", MODELS);
        api.returns("workspace.getConfig", wsWithLsp);
        await goToLanguageServersTab(page, api);
        await expect(page.locator(".ls-configured-list")).toBeVisible();
        await expect(page.locator(".ls-configured-item__name").filter({ hasText: "typescript-language-server" })).toBeVisible();
    });

    test("LS-E-2: configured server shows command", async ({ page, api }) => {
        const wsWithLsp = makeWorkspace({
            lsp: {
                servers: [
                    { name: "typescript-language-server", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts"] },
                ],
            },
        });
        api.returns("models.list", MODELS);
        api.returns("workspace.getConfig", wsWithLsp);
        await goToLanguageServersTab(page, api);
        await expect(page.locator(".ls-configured-item__cmd").filter({ hasText: "typescript-language-server" })).toBeVisible();
    });

    test("LS-E-3: configured server count shown in section header", async ({ page, api }) => {
        const wsWithLsp = makeWorkspace({
            lsp: {
                servers: [
                    { name: "typescript-language-server", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts"] },
                    { name: "pylsp", command: "pylsp", args: [], extensions: [".py"] },
                ],
            },
        });
        api.returns("models.list", MODELS);
        api.returns("workspace.getConfig", wsWithLsp);
        await goToLanguageServersTab(page, api);
        await expect(page.locator(".ls-configured-label")).toContainText("2");
    });

    test("LS-E-4: no configured servers list when workspace has no LSP servers", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.returns("workspace.getConfig", makeWorkspace());
        await goToLanguageServersTab(page, api);
        await expect(page.locator(".ls-configured-list")).not.toBeVisible();
    });
});

// ─── Suite LS-W — Workspace switch ──────────────────────────────────────────

test.describe("LS-W — Workspace switch", () => {
    test("LS-W-1: switching workspace on Projects tab clears and re-scans language badges", async ({ page, api }) => {
        // Two workspaces, each with one project
        api.returns("workspace.list", [
            { key: WORKSPACE_KEY, name: "Test Workspace" },
            { key: "ws-2", name: "Workspace 2" },
        ]);
        api.returns("models.list", MODELS);

        // ws-2 has its own project; projects.list returns ALL projects across workspaces (filtered in UI)
        const ws2Project = makeProject({ key: "ws2-proj", workspaceKey: "ws-2", name: "WS2 Project" });
        api.returns("projects.list", [makeProject(), ws2Project]);

        // workspace.getConfig responds per workspace
        api.handle("workspace.getConfig", ({ workspaceKey }) =>
            makeWorkspace({ key: workspaceKey ?? WORKSPACE_KEY }),
        );

        // detectLanguages: original workspace returns TypeScript, ws-2 returns empty
        const detectCalls: { projectPath: string; workspaceKey: string }[] = [];
        api.handle("lsp.detectLanguages", (params) => {
            detectCalls.push(params as { projectPath: string; workspaceKey: string });
            if (params.workspaceKey === "ws-2") return [];
            return [makeTypescriptLang({ alreadyInstalled: true, inConfig: true })];
        });

        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();

        // Original workspace: TypeScript badge should appear
        await expect(page.locator(".project-item__lang-badge").filter({ hasText: "TypeScript" })).toBeVisible({ timeout: 5_000 });

        // Clear recorded detect calls so we can verify re-scan
        detectCalls.length = 0;

        // Switch workspace via the picker
        await page.locator(".setup-workspace-picker__select").click();
        await page.getByRole("option", { name: "Workspace 2" }).click();

        // Scan should be triggered for ws-2 (detectCalls should include ws-2)
        await expect.poll(() => detectCalls.some((c) => c.workspaceKey === "ws-2"), { timeout: 5_000 }).toBe(true);

        // ws-2 has no languages — badge column should show "—" (no spinner stuck)
        await expect(page.locator(".project-item__no-lang")).toBeVisible({ timeout: 5_000 });

        // Original TypeScript badge must be gone
        await expect(page.locator(".project-item__lang-badge").filter({ hasText: "TypeScript" })).not.toBeVisible();
    });
});
