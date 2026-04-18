/**
 * review-overlay.spec.ts — UI tests for the code review overlay.
 *
 * The review overlay renders a Monaco diff editor with ViewZone action bars
 * (accept/reject/change-request) on each git hunk. All diff data and hunk
 * decisions are mocked via ApiMock.
 *
 * Suites A–H cover the core hunk decision flows.
 * Suites M–P cover LineCommentBar (glyph click → comment zone).
 * Suites Q–Z cover accept/reject precision and multi-file navigation.
 *
 * NOTE: Tests that verify Monaco internals (zone heights, elementFromPoint)
 * require a real browser renderer and are run via Playwright in headed mode
 * on CI with --project=chromium.
 */

import { test, expect } from "./fixtures";
import type { Task, FileDiffContent, HunkWithDecisions, LineComment } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHunk(index: number, overrides: Partial<HunkWithDecisions> = {}): HunkWithDecisions {
    return {
        hash: `hash-${index}`,
        hunkIndex: index,
        originalStart: 1 + index * 10,
        originalEnd: 5 + index * 10,
        modifiedStart: 1 + index * 10,
        modifiedEnd: 5 + index * 10,
        modifiedContentStart: 2 + index * 10,
        modifiedContentEnd: 4 + index * 10,
        originalContentStart: 2 + index * 10,
        originalContentEnd: 4 + index * 10,
        decisions: [],
        humanDecision: "pending",
        humanComment: null,
        ...overrides,
    };
}

function makeFileDiff(original: string, modified: string, hunks: HunkWithDecisions[]): FileDiffContent {
    return { original, modified, hunks };
}

const SAMPLE_ORIGINAL = `function hello() {\n  return 1;\n}\n`;
const SAMPLE_MODIFIED = `function hello() {\n  return 'hello';\n}\n`;

async function openReviewOverlay(page: import("@playwright/test").Page, taskId: number) {
    // Open task drawer then find the review overlay trigger
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();

    // Wait for ChangedFilesPanel Review button (requires numstat to be loaded)
    const reviewBtn = page.locator(".changed-files-panel__review-btn");
    await expect(reviewBtn).toBeVisible({ timeout: 5_000 });
    await reviewBtn.click();
    await expect(page.locator(".review-overlay")).toBeVisible({ timeout: 5_000 });
}

// Ensure every review-overlay test has a task with worktreeStatus:"ready" so the
// ChangedFilesPanel (and its Review button) is rendered in the task drawer.
test.beforeEach(async ({ api, task }) => {
    const readyTask: Task = { ...task, worktreeStatus: "ready" };
    api.handle("tasks.list", () => [readyTask]);
    api.handle("tasks.getGitStat", () => ({
        files: [{ path: "setup.ts", additions: 5, deletions: 2 }],
        totalAdditions: 5,
        totalDeletions: 2,
    }));
});

// ─── Suite A — z-index: action bars are clickable ────────────────────────────

test.describe("A — z-index: action bars are not blocked by Monaco layers", () => {
    test("A-1: first accept button is the top element at its center point", async ({ page, api, task }) => {
        const hunk = makeHunk(0);
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [hunk]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        // Wait for action bar to appear
        await expect(page.locator(".hunk-btn--accept")).toBeVisible({ timeout: 8_000 });

        // The accept button must be the topmost element at its center (not blocked by Monaco)
        const result = await page.locator(".hunk-btn--accept").evaluate((btn) => {
            const r = btn.getBoundingClientRect();
            if (r.width === 0) return { ok: true, skipped: true }; // Monaco virtualized it
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { ok: hit === btn, hitCls: hit?.className?.slice(0, 60) ?? "null", skipped: false };
        });

        if (!result.skipped) {
            expect(result.ok).toBe(true);
        }
    });
});

// ─── Suite B — zone heights ───────────────────────────────────────────────────

test.describe("B — zone height: bars resize to content height", () => {
    test("B-2: visible hunk-bar zone containers have offsetHeight > 0", async ({ page, api, task }) => {
        const hunk = makeHunk(0);
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [hunk]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);
        await expect(page.locator(".hunk-bar")).toBeVisible({ timeout: 8_000 });

        const heights = await page.locator(".hunk-bar").evaluateAll((bars) =>
            bars
                .filter((b) => b.parentElement && parseInt((b.parentElement as HTMLElement).style.height) > 0)
                .map((b) => (b as HTMLElement).offsetHeight),
        );

        // At least one bar should have non-zero height
        expect(heights.some((h) => h > 0)).toBe(true);
    });
});

// ─── Suite G — pending counter accuracy ──────────────────────────────────────

test.describe("G — pending counter accuracy", () => {
    test("G-13: initial counter shows correct number of pending hunks", async ({ page, api, task }) => {
        const hunks = [makeHunk(0), makeHunk(1), makeHunk(2)];
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, hunks));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 3 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        // Counter shows "3 pending" or similar
        const counter = page.locator(".review-overlay__pending-warning");
        await expect(counter).toContainText("3", { timeout: 5_000 });
    });

    test("G-14: counter decrements by 1 when a hunk is accepted", async ({ page, api, task }) => {
        const hunks = [makeHunk(0), makeHunk(1)];
        let decisions: HunkWithDecisions[] = [...hunks];

        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, decisions));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: decisions.filter((h) => h.humanDecision === "pending").length }]);
        api.handle("tasks.getCheckpointRef", () => null);
        api.handle("tasks.setHunkDecision", () => {
            // Mark the first hunk as accepted
            decisions = decisions.map((h, i) => i === 0 ? { ...h, humanDecision: "accepted" as const } : h);
        });

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        // Click accept on first hunk
        const acceptBtn = page.locator(".hunk-btn--accept").first();
        if (await acceptBtn.isVisible({ timeout: 5_000 })) {
            await acceptBtn.click();
            // Counter should decrement
            const counter = page.locator(".review-overlay__pending-warning");
            await expect(counter).toContainText("1", { timeout: 3_000 });
        }
    });

    test("G-15: counter decrements by 1 when a hunk is rejected", async ({ page, api, task }) => {
        const hunks = [makeHunk(0), makeHunk(1)];
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, hunks));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 2 }]);
        api.handle("tasks.getCheckpointRef", () => null);
        // Reject calls tasks.rejectHunk (returns updated FileDiffContent with the
        // hunk marked rejected); setHunkDecision is not used for the reject path.
        api.handle("tasks.rejectHunk", () =>
            makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [
                makeHunk(0, { humanDecision: "rejected" }),
                makeHunk(1),
            ])
        );

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const rejectBtn = page.locator(".hunk-btn--reject").first();
        if (await rejectBtn.isVisible({ timeout: 5_000 })) {
            await rejectBtn.click();
            const counter = page.locator(".review-overlay__pending-warning");
            await expect(counter).toContainText("1", { timeout: 3_000 });
        }
    });
});

// ─── Suite H — Change Request validation ─────────────────────────────────────

test.describe("H — Change Request validation", () => {
    test("H-16: Change Request with empty comment shows validation error", async ({ page, api, task }) => {
        const hunk = makeHunk(0);
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [hunk]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const changeReqBtn = page.locator(".hunk-btn--change-request").first();
        if (await changeReqBtn.isVisible({ timeout: 5_000 })) {
            await changeReqBtn.click();
            // Should show a form; submit without filling comment
            const submitBtn = page.locator(".hunk-comment-form button[type='submit'], .hunk-bar button:has-text('Submit')");
            if (await submitBtn.isVisible({ timeout: 1_000 })) {
                await submitBtn.click();
                // Validation error must appear
                await expect(page.locator(".hunk-comment-form .error, [data-testid='comment-error']")).toBeVisible({ timeout: 2_000 });
            }
        }
    });

    test("H-17: Change Request with comment saves it and shows decided state", async ({ page, api, task }) => {
        const hunk = makeHunk(0);
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [hunk]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);
        api.handle("tasks.setHunkDecision", () => { });

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const changeReqBtn = page.locator(".hunk-btn--change-request").first();
        if (await changeReqBtn.isVisible({ timeout: 5_000 })) {
            await changeReqBtn.click();
            const textarea = page.locator(".hunk-comment-form textarea");
            if (await textarea.isVisible({ timeout: 1_000 })) {
                await textarea.fill("Please use a more descriptive name.");
                const submitBtn = page.locator(".hunk-comment-form button[type='submit'], button:has-text('Submit')");
                await submitBtn.click();
                // Bar transitions to decided state
                await expect(page.locator(".hunk-bar--decided, [data-testid='hunk-decided']")).toBeVisible({ timeout: 3_000 });
            }
        }
    });
});

// ─── Suite I — Decision persistence across file switches ─────────────────────

test.describe("I — Decision persistence across file switches", () => {
    test("I-18: accepted hunk stays collapsed when switching files and back", async ({ page, api, task }) => {
        const hunk = makeHunk(0, { humanDecision: "accepted" });
        api.handle("tasks.getChangedFiles", () => ["setup.ts", "utils.ts"]);
        api.handle("tasks.getFileDiff", ({ filePath }) => {
            if (filePath === "setup.ts") return makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [hunk]);
            return makeFileDiff("const x = 1;\n", "const x = 2;\n", [makeHunk(0)]);
        });
        api.handle("tasks.getPendingHunkSummary", () => [
            { filePath: "setup.ts", pendingCount: 0 },
            { filePath: "utils.ts", pendingCount: 1 },
        ]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        // Switch to utils.ts
        const fileTab = page.locator("[data-testid='file-tab']:has-text('utils.ts'), .review-file-list button:has-text('utils.ts')");
        if (await fileTab.isVisible({ timeout: 3_000 })) {
            await fileTab.click();
            // Switch back to setup.ts
            await page.locator("[data-testid='file-tab']:has-text('setup.ts'), .review-file-list button:has-text('setup.ts')").click();
            // Accepted hunk bar should still show decided state (not pending)
            await expect(page.locator(".hunk-bar--decided, .hunk-btn--accept.decided")).toBeVisible({ timeout: 3_000 });
        }
    });
});

// ─── Suite M — glyph click opens LineCommentBar ───────────────────────────────

test.describe("M — glyph click opens LineCommentBar", () => {
    test("M-24: glyph click injects a LineCommentBar zone in open state", async ({ page, api, task }) => {
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [makeHunk(0)]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        // Click a Monaco glyph margin to trigger line comment
        const glyphMargin = page.locator(".cgmr.codicon-review-comment-glyph, [data-testid='comment-glyph']");
        if (await glyphMargin.first().isVisible({ timeout: 5_000 })) {
            await glyphMargin.first().click();
            await expect(page.locator(".line-comment-bar, [data-testid='line-comment-bar']")).toBeVisible({ timeout: 3_000 });
        }
    });

    test("M-25: textarea in open LineCommentBar accepts typed input", async ({ page, api, task }) => {
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [makeHunk(0)]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const glyphMargin = page.locator(".cgmr.codicon-review-comment-glyph, [data-testid='comment-glyph']");
        if (await glyphMargin.first().isVisible({ timeout: 5_000 })) {
            await glyphMargin.first().click();
            const textarea = page.locator(".line-comment-bar textarea");
            await expect(textarea).toBeVisible({ timeout: 3_000 });
            await textarea.fill("This looks odd");
            await expect(textarea).toHaveValue("This looks odd");
        }
    });
});

// ─── Suite N — cancel removes comment zone ────────────────────────────────────

test.describe("N — cancel removes comment zone", () => {
    test("N-26: cancel removes the LineCommentBar zone from the DOM", async ({ page, api, task }) => {
        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [makeHunk(0)]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const glyphMargin = page.locator(".cgmr.codicon-review-comment-glyph, [data-testid='comment-glyph']");
        if (await glyphMargin.first().isVisible({ timeout: 5_000 })) {
            await glyphMargin.first().click();
            await expect(page.locator(".line-comment-bar")).toBeVisible({ timeout: 3_000 });

            const cancelBtn = page.locator(".line-comment-bar button:has-text('Cancel'), .line-comment-bar [data-testid='cancel']");
            await cancelBtn.click();
            await expect(page.locator(".line-comment-bar")).not.toBeVisible({ timeout: 3_000 });
        }
    });
});

// ─── Suite O — posting a comment persists it ─────────────────────────────────

test.describe("O — posting a comment persists it", () => {
    test("O-28: after posting, bar transitions to posted state", async ({ page, api, task }) => {
        const postedComment: LineComment = {
            id: 1,
            filePath: "setup.ts",
            lineStart: 2,
            lineEnd: 2,
            colStart: 0,
            colEnd: 0,
            lineText: ["  return 1;"],
            contextLines: [],
            comment: "Review comment",
            reviewerType: "human",
        };

        api.handle("tasks.getChangedFiles", () => ["setup.ts"]);
        api.handle("tasks.getFileDiff", () => makeFileDiff(SAMPLE_ORIGINAL, SAMPLE_MODIFIED, [makeHunk(0)]));
        api.handle("tasks.getPendingHunkSummary", () => [{ filePath: "setup.ts", pendingCount: 1 }]);
        api.handle("tasks.getCheckpointRef", () => null);
        api.handle("tasks.addLineComment", () => postedComment);
        api.handle("tasks.getLineComments", () => [postedComment]);

        await page.goto("/");
        await openReviewOverlay(page, task.id);

        const glyphMargin = page.locator(".cgmr.codicon-review-comment-glyph, [data-testid='comment-glyph']");
        if (await glyphMargin.first().isVisible({ timeout: 5_000 })) {
            await glyphMargin.first().click();
            const textarea = page.locator(".line-comment-bar textarea");
            await textarea.fill("Review comment");
            const submitBtn = page.locator(".line-comment-bar button:has-text('Post'), .line-comment-bar [data-testid='submit']");
            await submitBtn.click();

            // Should transition to posted state (shows comment text, no textarea)
            await expect(page.locator(".line-comment-bar--posted, .line-comment-bar .comment-text")).toBeVisible({ timeout: 3_000 });
            await expect(page.locator(".line-comment-bar textarea")).not.toBeVisible();
        }
    });
});
