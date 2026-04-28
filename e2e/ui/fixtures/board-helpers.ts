/**
 * board-helpers.ts — Shared helpers for board Playwright specs.
 *
 * Extracted from board.spec.ts so all board test files can share navigation
 * and drag-and-drop utilities without duplication.
 */

import { expect, type Page, type Locator } from "@playwright/test";

/** Navigate to the board view and wait until columns are visible. */
export async function navigateToBoard(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.locator(".board-columns, [data-testid='board-columns']")).toBeVisible({
        timeout: 5_000,
    });
}

/**
 * Begin a drag on a task card: pointerdown at the card center then move >5px
 * to cross the activation threshold in BoardView.vue.
 * Leaves the mouse button held — call dragCardToColumn or page.mouse.up() to finish.
 */
export async function startDragOnCard(page: Page, card: Locator): Promise<void> {
    const box = await card.boundingBox();
    if (!box) throw new Error("startDragOnCard: card has no bounding box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Move past the 5-px activation threshold
    await page.mouse.move(cx, cy + 10, { steps: 3 });
}

/**
 * Perform a full drag: pointerdown on card, move to column center, pointerup.
 * The column locator should target an element with [data-column-id].
 */
export async function dragCardToColumn(
    page: Page,
    card: Locator,
    column: Locator,
): Promise<void> {
    await startDragOnCard(page, card);
    const colBox = await column.boundingBox();
    if (!colBox) throw new Error("dragCardToColumn: column has no bounding box");
    await page.mouse.move(
        colBox.x + colBox.width / 2,
        colBox.y + colBox.height / 2,
        { steps: 10 },
    );
    await page.mouse.up();
}

/**
 * Assert that the drag ghost element (fixed-position clone) is present in the DOM.
 * BoardView.vue appends it to document.body with position:fixed; pointer-events:none; z-index:9999.
 */
export async function assertGhostInDom(page: Page): Promise<void> {
    const hasGhost = await page.evaluate(() =>
        Array.from(document.body.children).some((el) => {
            const style = (el as HTMLElement).style;
            return (
                style.position === "fixed" &&
                style.pointerEvents === "none" &&
                style.zIndex === "9999"
            );
        }),
    );
    expect(hasGhost).toBe(true);
}
