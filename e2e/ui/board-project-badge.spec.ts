import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";
import { makeTask, makeProject } from "./fixtures/mock-data";

test.describe("Board project badge", () => {
    test("PB-1: task card shows resolved project name", async ({ page, api }) => {
        api.returns("projects.list", [makeProject()]);
        // default task has projectKey: "test-project" which matches makeProject() key

        await navigateToBoard(page);

        await expect(page.locator(".task-card__project")).toHaveText("Test Project");
    });

    test("PB-2: task card falls back to raw project key when project is not found", async ({ page }) => {
        // baseline fixture already has projects.list: [] — no override needed

        await navigateToBoard(page);

        await expect(page.locator(".task-card__project")).toHaveText("test-project");
    });

    test("PB-3: each card shows its own project name (multi-project)", async ({ page, api }) => {
        api.returns("projects.list", [
            makeProject({ key: "alpha", name: "Alpha" }),
            makeProject({ key: "beta", name: "Beta" }),
        ]);
        api.returns("tasks.list", [
            makeTask({ id: 1, projectKey: "alpha", workflowState: "backlog", position: 0 }),
            makeTask({ id: 2, projectKey: "beta", workflowState: "backlog", position: 1000 }),
        ]);

        await navigateToBoard(page);

        const cards = page.locator(".task-card__project");
        await expect(cards.nth(0)).toHaveText("Alpha");
        await expect(cards.nth(1)).toHaveText("Beta");
    });

    test("PB-4: changed-files badge is absent from card", async ({ page, api }) => {
        api.returns("tasks.getChangedFiles", ["src/foo.ts", "src/bar.ts"]);

        await navigateToBoard(page);

        await expect(page.locator(".task-card__changed-badge")).toHaveCount(0);
    });

    test("PB-5: retry count indicator is absent from card", async ({ page, api }) => {
        api.returns("tasks.list", [makeTask({ retryCount: 3, workflowState: "backlog" })]);

        await navigateToBoard(page);

        await expect(page.locator(".task-card__retry-count")).toHaveCount(0);
    });

    test("PB-6: footer contains execution badge and project name on same row", async ({ page, api }) => {
        api.returns("projects.list", [makeProject()]);

        await navigateToBoard(page);

        const footer = page.locator(".task-card__footer");
        await expect(footer.locator(".p-tag")).toBeVisible();
        await expect(footer.locator(".task-card__project")).toBeVisible();
    });
});
