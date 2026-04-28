import { test, expect } from "./fixtures";
import { navigateToBoard } from "./fixtures/board-helpers";

test.describe("Board project badge", () => {
    test("PB-1: task card shows project key badge when task has a projectKey", async ({ page }) => {
        test.fail(); // Known gap: TaskCard.vue does not render projectKey as a badge

        await navigateToBoard(page);

        // The default task has projectKey: "test-project" (from makeTask defaults).
        // A correctly implemented card would render a project badge element.
        await expect(
            page.locator("[data-task-id]").locator('.task-card__project-badge, [data-testid="project-badge"]'),
        ).toBeVisible();
    });
});
