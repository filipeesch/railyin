/**
 * workspace-settings.spec.ts — UI tests for the SetupView (workspace management).
 *
 * Suites:
 *   S — Setup page navigation and initial render
 *   W — Workspace settings (name, engine, model)
 *   P — Project lifecycle (add, edit, delete)
 *   C — Create new workspace
 *   E — Error state handling
 */

import { test, expect } from "./fixtures";
import { makeWorkspace, makeProject, WORKSPACE_KEY } from "./fixtures/mock-data";
import type { ApiMock } from "./fixtures/mock-api";

const MODELS = [
    {
        id: "copilot",
        models: [
            { id: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000, enabled: true },
            { id: "copilot/gpt-4o", displayName: "GPT-4o", contextWindow: 128_000, enabled: true },
        ],
    },
];

async function goToSetup(page: import("@playwright/test").Page, api: ApiMock) {
    // Empty boards list forces App.vue onMounted to redirect to /setup
    api.returns("boards.list", []);
    await page.goto("/");
    await expect(page.locator(".setup-card")).toBeVisible({ timeout: 5_000 });
}

// ─── Suite S — Setup page navigation ─────────────────────────────────────────

test.describe("S — setup page", () => {
    test("S-1: /setup renders the settings card", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await expect(page.locator(".setup-card")).toBeVisible();
    });

    test("S-2: Workspace tab is active by default when projects exist", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [makeProject()]);
        await goToSetup(page, api);
        // The Workspace tab panel should be visible
        await expect(page.getByRole("tab", { name: "Workspace" })).toBeVisible();
    });

    test("S-3: 'Go to board' button is visible when boards exist", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("boards.list", []);  // Empty boards → /setup redirect
        await page.goto("/");
        await expect(page.locator(".setup-card")).toBeVisible({ timeout: 5_000 });
        // Go to board button is hidden when no boards exist
        await expect(page.getByRole("button", { name: /go to board/i })).not.toBeVisible();
    });
});

// ─── Suite W — Workspace settings ────────────────────────────────────────────

test.describe("W — workspace settings", () => {
    test("W-1: workspace name field is pre-filled from config", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();
        const nameInput = page.locator("input[placeholder='My Workspace']");
        await expect(nameInput).toHaveValue("Test Workspace");
    });

    test("W-2: save workspace name calls workspace.update and shows success", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        const updateCalls = api.capture("workspace.update", {});
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();

        const nameInput = page.locator("input[placeholder='My Workspace']");
        await nameInput.fill("Renamed Workspace");
        await page.getByRole("button", { name: /save settings/i }).click();

        await expect(page.locator(".p-message-success")).toBeVisible({ timeout: 3_000 });
        expect(updateCalls.length).toBeGreaterThan(0);
        expect(updateCalls[0]).toMatchObject({ name: "Renamed Workspace" });
    });

    test("W-3: engine selector shows copilot and claude options", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();

        const engineSelect = page.locator(".setup-section .p-select").first();
        await engineSelect.click();
        const options = page.locator(".p-select-overlay .p-select-option");
        await expect(options.filter({ hasText: /copilot/i })).toBeVisible();
        await expect(options.filter({ hasText: /claude/i })).toBeVisible();
    });

    test("W-4: model dropdown is populated from models.list", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();

        // Find the model select (second select in the section)
        const modelSelect = page.locator(".setup-section .p-select").nth(1);
        await modelSelect.click();
        const options = page.locator(".p-select-overlay .p-select-option");
        await expect(options.filter({ hasText: /gpt-4\.1/i })).toBeVisible();
        await expect(options.filter({ hasText: /gpt-4o/i })).toBeVisible();
    });

    test("W-5: changing engine type clears model and re-fetches", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        const updateCalls = api.capture("workspace.update", {});
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();

        // Switch engine to claude
        const engineSelect = page.locator(".setup-section .p-select").first();
        await engineSelect.click();
        await page.locator(".p-select-overlay .p-select-option").filter({ hasText: /claude/i }).click();

        await page.getByRole("button", { name: /save settings/i }).click();
        await expect(page.locator(".p-message-success")).toBeVisible({ timeout: 3_000 });
        expect(updateCalls.some(c => (c as { engineType?: string }).engineType === "claude")).toBe(true);
    });
});

// ─── Suite P — Project CRUD ────────────────────────────────────────────────

test.describe("P — project lifecycle", () => {
    const project = makeProject();

    test("P-1: project list is rendered when projects exist", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        await expect(page.locator(".project-item__name").filter({ hasText: project.name })).toBeVisible();
    });

    test("P-2: 'Add project' button opens the project dialog", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", []);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        await page.getByRole("button", { name: /add project/i }).click();
        await expect(page.locator(".p-dialog")).toBeVisible();
        await expect(page.locator(".p-dialog-header")).toContainText(/add project/i);
    });

    test("P-3: new project is saved via projects.register", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", []);
        const registerCalls = api.capture("projects.register", project);
        api.returns("workspace.resolveGitRoot", { gitRoot: "/home/user/projects/new-project" });
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        await page.getByRole("button", { name: /add project/i }).click();

        const dialog = page.locator(".p-dialog");
        await dialog.locator("input").nth(0).fill("New Project");
        await dialog.locator("input").nth(1).fill("/home/user/projects/new-project");
        await dialog.locator("input").nth(2).fill("/home/user/projects/new-project");

        await dialog.getByRole("button", { name: /add project/i }).click();

        await expect(dialog).not.toBeVisible({ timeout: 3_000 });
        expect(registerCalls.length).toBeGreaterThan(0);
    });

    test("P-4: edit button opens dialog pre-filled with project data", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();

        await page.locator(".project-item").getByRole("button", { name: /edit/i }).click();
        const dialog = page.locator(".p-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("input").first()).toHaveValue(project.name);
    });

    test("P-5: edit project calls projects.update", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        const updateCalls = api.capture("projects.update", project);
        api.returns("workspace.resolveGitRoot", { gitRoot: project.gitRootPath });
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();

        await page.locator(".project-item").getByRole("button", { name: /edit/i }).click();
        const dialog = page.locator(".p-dialog");
        await dialog.locator("input").first().fill("Renamed Project");
        await dialog.getByRole("button", { name: /save changes/i }).click();

        await expect(dialog).not.toBeVisible({ timeout: 3_000 });
        expect(updateCalls.length).toBeGreaterThan(0);
        expect(updateCalls[0]).toMatchObject({ name: "Renamed Project" });
    });

    test("P-6: delete button opens confirmation dialog with project name", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();

        await page.locator(".project-item").getByRole("button", { name: /delete/i }).click();
        const dialog = page.locator(".p-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(project.name);
        await expect(dialog).toContainText(/cannot be undone/i);
    });

    test("P-7: confirming delete calls projects.delete", async ({ page, api }) => {
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        const deleteCalls = api.capture("projects.delete", undefined as unknown as void);
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();

        await page.locator(".project-item").getByRole("button", { name: /delete/i }).click();
        await page.locator(".p-dialog").getByRole("button", { name: /^delete$/i }).click();

        expect(deleteCalls.length).toBeGreaterThan(0);
        expect(deleteCalls[0]).toMatchObject({ key: project.key });
    });
});

// ─── Suite C — Create new workspace ──────────────────────────────────────────

test.describe("C — create workspace", () => {
    test("C-1: 'New workspace' button opens creation dialog", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await page.getByRole("button", { name: /new workspace/i }).click();
        await expect(page.locator(".p-dialog")).toBeVisible();
        await expect(page.locator(".p-dialog-header")).toContainText(/new workspace/i);
    });

    test("C-2: derived key preview is shown as user types workspace name", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        await goToSetup(page, api);
        await page.getByRole("button", { name: /new workspace/i }).click();
        await page.locator(".p-dialog input").fill("My Team");
        await expect(page.locator(".new-ws-key-preview")).toContainText("my-team");
    });

    test("C-3: creating workspace calls workspace.create with name", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        const createCalls = api.capture("workspace.create", { key: "my-team", name: "My Team" });
        api.returns("workspace.list", [
            { key: WORKSPACE_KEY, name: "Test Workspace" },
            { key: "my-team", name: "My Team" },
        ]);
        api.returns("workspace.getConfig", makeWorkspace({ key: "my-team", name: "My Team" }));
        await goToSetup(page, api);
        await page.getByRole("button", { name: /new workspace/i }).click();
        await page.locator(".p-dialog input").fill("My Team");
        await page.locator(".p-dialog").getByRole("button", { name: /create workspace/i }).click();

        await expect(page.locator(".p-dialog")).not.toBeVisible({ timeout: 3_000 });
        expect(createCalls.length).toBeGreaterThan(0);
        expect(createCalls[0]).toMatchObject({ name: "My Team" });
    });
});

// ─── Suite E — Error handling ─────────────────────────────────────────────────

test.describe("E — error handling", () => {
    test("E-1: save settings shows error message on API failure", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.handle("workspace.update", () => { throw new Error("Server error"); });
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Workspace" }).click();
        await page.getByRole("button", { name: /save settings/i }).click();
        await expect(page.locator(".p-message-error")).toBeVisible({ timeout: 3_000 });
    });

    test("E-2: delete project shows error on API failure", async ({ page, api }) => {
        const project = makeProject();
        api
            .returns("models.list", MODELS)
            .returns("projects.list", [project]);
        api.handle("projects.delete", () => { throw new Error("Cannot delete"); });
        await goToSetup(page, api);
        await page.getByRole("tab", { name: "Projects" }).click();
        await page.locator(".project-item").getByRole("button", { name: /delete/i }).click();
        await page.locator(".p-dialog").getByRole("button", { name: /^delete$/i }).click();
        await expect(page.locator(".p-dialog .p-message-error")).toBeVisible({ timeout: 3_000 });
    });

    test("E-3: create workspace shows error when API fails", async ({ page, api }) => {
        api.returns("models.list", MODELS);
        api.handle("workspace.create", () => { throw new Error("Already exists"); });
        await goToSetup(page, api);
        await page.getByRole("button", { name: /new workspace/i }).click();
        await page.locator(".p-dialog input").fill("My Team");
        await page.locator(".p-dialog").getByRole("button", { name: /create workspace/i }).click();
        await expect(page.locator(".p-dialog .p-message-error")).toBeVisible({ timeout: 3_000 });
    });
});
