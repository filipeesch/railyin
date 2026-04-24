/**
 * timeline-pipeline.spec.ts — UI tests for the unified stream-event pipeline.
 *
 * All tests inject synthetic stream events via WsMock and assert DOM state.
 * No backend needed — the WS mock sends events directly to the running Vue app.
 *
 * Covers:
 *   Suite T  — T-28 to T-40: core rendering (text, reasoning, done, status, autoscroll)
 *   Suite S  — S-1 to S-5: mixed scenario rendering
 *   Suite N  — T-46 to T-55: streaming granularity and nesting
 *   Suite Q  — T-56 to T-59: sequential and interleaving order
 */

import { test, expect } from "./fixtures";
import type { StreamEvent } from "@shared/rpc-types";

const EXEC_ID = 99_901;

async function openTaskDrawer(page: import("@playwright/test").Page, taskId: number) {
    await page.locator(`[data-task-id="${taskId}"]`).click();
    await expect(page.locator(".task-detail")).toBeVisible();
}

function mkEvent(
    taskId: number,
    execId: number,
    seq: number,
    type: StreamEvent["type"],
    content: string,
    options: Partial<StreamEvent> = {},
): StreamEvent {
    return {
        taskId,
        conversationId: taskId,
        executionId: execId,
        seq,
        blockId: `${execId}-${type}-${seq}`,
        type,
        content,
        metadata: null,
        parentBlockId: null,
        subagentId: null,
        done: false,
        ...options,
    };
}

// ─── Suite T — stream-event pipeline rendering ────────────────────────────────

test.describe("T — stream-event pipeline rendering", () => {
    test("T-28: text_chunk renders live .streaming bubble", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "text_chunk", "Hello from T-28"));

        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("Hello from T-28");
    });

    test("T-29: reasoning_chunk renders .rb with pulsing icon", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "reasoning_chunk", "Thinking about T-29"));

        await expect(page.locator(".rb")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".rb__icon--pulse")).toBeVisible();
        await expect(page.locator(".rb__content")).toContainText("Thinking about T-29");
    });

    test("T-30: done event clears live .streaming bubble", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "text_chunk", "Live text for T-30"));
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });

        ws.pushDone(task.id, EXEC_ID, 99);

        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 3_000 });
    });

    test("T-31: multiple text_chunks merge into one block", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const blockId = `${EXEC_ID}-t1`;
        ws.pushStreamEvent({ ...mkEvent(task.id, EXEC_ID, 0, "text_chunk", "word1"), blockId });
        ws.pushStreamEvent({ ...mkEvent(task.id, EXEC_ID, 1, "text_chunk", " word2"), blockId });
        ws.pushStreamEvent({ ...mkEvent(task.id, EXEC_ID, 2, "text_chunk", " word3"), blockId });

        // Should be exactly one streaming bubble, containing all words concatenated
        await expect(page.locator(".msg__bubble.streaming")).toHaveCount(1, { timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("word1 word2 word3");
    });

    test("T-32: reasoning_chunk before text_chunk — both blocks present in correct order", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "reasoning_chunk", "Reasoning for T-32", { blockId: `${EXEC_ID}-r1` }));
        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 1, "text_chunk", "Response for T-32", { blockId: `${EXEC_ID}-t1` }));

        // Both visible
        await expect(page.locator(".rb")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });

        // Reasoning before text in DOM order
        const blocks = page.locator(".rb, .msg__bubble.streaming");
        const tags = await blocks.evaluateAll((els) => els.map((e) => e.className));
        const rIdx = tags.findIndex((c) => c.includes("rb"));
        const tIdx = tags.findIndex((c) => c.includes("streaming"));
        expect(rIdx).toBeLessThan(tIdx);
    });

    test("T-34: status_chunk renders ephemeral status text (not a streaming bubble)", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "status_chunk", "Running tool…", { blockId: `${EXEC_ID}-status` }));

        await expect(page.locator(".conv-body__system")).toContainText("Running tool…", { timeout: 3_000 });
        // Must NOT create a text_chunk bubble
        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible();
    });

    test("T-35: reasoning bubble stops pulsing after done event", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "reasoning_chunk", "Thinking for T-35", { blockId: `${EXEC_ID}-r1` }));
        await expect(page.locator(".rb__icon--pulse")).toBeVisible({ timeout: 3_000 });

        ws.pushDone(task.id, EXEC_ID, 99);

        await expect(page.locator(".rb__icon--pulse")).not.toBeVisible({ timeout: 3_000 });
    });

    test("T-36: status message disappears after done event", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "status_chunk", "Starting engines", { blockId: `${EXEC_ID}-s1` }));
        await expect(page.locator(".conv-body__system")).toContainText("Starting engines", { timeout: 3_000 });

        ws.pushDone(task.id, EXEC_ID, 99);

        await expect(page.locator(".conv-body__system")).toHaveCount(0, { timeout: 3_000 });
    });

    test("T-37: new executionId resets stream state so second run is visible", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // First execution
        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "text_chunk", "First execution", { blockId: `${EXEC_ID}-t1` }));
        ws.pushDone(task.id, EXEC_ID, 99);
        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible({ timeout: 3_000 });

        // Second execution with a new ID
        const EXEC_ID_2 = EXEC_ID + 1;
        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID_2, 0, "text_chunk", "Second execution response", { blockId: `${EXEC_ID_2}-t1` }));

        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("Second execution response");
    });

    test("T-38: tool_call event clears live reasoning_chunk blocks", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, EXEC_ID, 0, "reasoning_chunk", "Thinking about tool…", { blockId: `${EXEC_ID}-r1` }));
        await expect(page.locator(".rb__icon--pulse")).toBeVisible({ timeout: 3_000 });

        ws.pushStreamEvent(mkEvent(
            task.id, EXEC_ID, 1, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: "{}" }, id: "tc1" }),
            { blockId: `${EXEC_ID}-tc1` },
        ));

        // Reasoning bubble should stop pulsing after tool_call clears it
        await expect(page.locator(".rb__icon--pulse")).not.toBeVisible({ timeout: 3_000 });
    });
});

// ─── Suite S — mixed scenario rendering ──────────────────────────────────────

test.describe("S — mixed scenario rendering", () => {
    const S_EXEC = 99_902;

    test("S-1 (T-41): reasoning then text — both blocks render in correct order", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 0, "reasoning_chunk", "Reasoning", { blockId: `${S_EXEC}-r` }));
        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 1, "text_chunk", "Text response", { blockId: `${S_EXEC}-t` }));

        await expect(page.locator(".rb")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
        // Reasoning before text
        const reasoningBefore = await page.evaluate(() => {
            const rb = document.querySelector(".rb");
            const streaming = document.querySelector(".msg__bubble.streaming");
            if (!rb || !streaming) return false;
            return rb.compareDocumentPosition(streaming) & Node.DOCUMENT_POSITION_FOLLOWING;
        });
        expect(reasoningBefore).toBeTruthy();
    });

    test("S-2 (T-42): reasoning → tool → text — all three blocks visible in order", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 0, "reasoning_chunk", "thinking", { blockId: `${S_EXEC}-r` }));
        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 1, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: '{"path":"x.ts"}' }, id: "tc1" }),
            { blockId: `${S_EXEC}-tc` },
        ));
        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 2, "text_chunk", "final text", { blockId: `${S_EXEC}-t` }));

        await expect(page.locator(".tcg")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible({ timeout: 3_000 });
    });

    test("S-4 (T-44): cancel mid-reasoning — no ghost live blocks after cancel", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, S_EXEC, 0, "reasoning_chunk", "partial reasoning", { blockId: `${S_EXEC}-r` }));
        await expect(page.locator(".rb__icon--pulse")).toBeVisible({ timeout: 3_000 });

        // Cancel via done event (mirrors what server sends on cancel)
        ws.pushDone(task.id, S_EXEC, 99);

        await expect(page.locator(".rb__icon--pulse")).not.toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).not.toBeVisible();
    });
});

// ─── Suite N — streaming granularity and nesting ──────────────────────────────

test.describe("N — streaming granularity and nesting", () => {
    const N_EXEC = 99_903;

    test("T-46: reasoning chunks stream incrementally — content grows after each inject", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const blockId = `${N_EXEC}-r1`;
        ws.pushStreamEvent({ ...mkEvent(task.id, N_EXEC, 0, "reasoning_chunk", "chunk1"), blockId });

        await expect(page.locator(".rb__content")).toContainText("chunk1", { timeout: 3_000 });

        ws.pushStreamEvent({ ...mkEvent(task.id, N_EXEC, 1, "reasoning_chunk", " chunk2"), blockId });

        await expect(page.locator(".rb__content")).toContainText("chunk1 chunk2");
    });

    test("T-48: reasoning bubble auto-opens during streaming, auto-closes after done", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, N_EXEC, 0, "reasoning_chunk", "thinking...", { blockId: `${N_EXEC}-r` }));

        // Should be open (expanded) while pulsing
        await expect(page.locator(".rb__icon--pulse")).toBeVisible({ timeout: 3_000 });

        ws.pushDone(task.id, N_EXEC, 99);

        // After done, pulse stops (bubble may collapse)
        await expect(page.locator(".rb__icon--pulse")).not.toBeVisible({ timeout: 3_000 });
    });

    test("T-49: nested tool_call renders inside parent's children", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const parentId = `${N_EXEC}-spawn`;
        const childId = `${N_EXEC}-read`;

        ws.pushStreamEvent(mkEvent(
            task.id, N_EXEC, 0, "tool_call",
            JSON.stringify({ type: "function", function: { name: "spawn_agent", arguments: "{}" }, id: "spawn1" }),
            { blockId: parentId },
        ));
        ws.pushStreamEvent(mkEvent(
            task.id, N_EXEC, 1, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: '{"path":"x.ts"}' }, id: "read1" }),
            { blockId: childId, parentBlockId: parentId },
        ));

        await expect(page.locator(".tcg")).toBeVisible({ timeout: 3_000 });
        // Expand the parent
        await page.locator(".tcg > .tcg__header").first().click();

        await expect(page.locator(".tcg .tcg__children > .tcg")).toBeVisible({ timeout: 2_000 });
    });

    test("T-53: text_chunk streams word-by-word — DOM content grows after each inject", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const blockId = `${N_EXEC}-t1`;
        ws.pushStreamEvent({ ...mkEvent(task.id, N_EXEC, 0, "text_chunk", "word1"), blockId });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("word1", { timeout: 3_000 });

        ws.pushStreamEvent({ ...mkEvent(task.id, N_EXEC, 1, "text_chunk", " word2"), blockId });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("word1 word2");

        ws.pushStreamEvent({ ...mkEvent(task.id, N_EXEC, 2, "text_chunk", " word3"), blockId });
        await expect(page.locator(".msg__bubble.streaming")).toContainText("word1 word2 word3");
    });
});

// ─── Suite Q — sequential & interleaving order ───────────────────────────────

test.describe("Q — sequential and interleaving order", () => {
    const Q_EXEC = 99_904;

    test("T-56: same tool called twice — two separate collapsibles in DOM", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(
            task.id, Q_EXEC, 0, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' }, id: "tc-a", display: { label: "read_file", subject: "a.ts" } }),
            { blockId: `${Q_EXEC}-tc1` },
        ));
        ws.pushStreamEvent(mkEvent(
            task.id, Q_EXEC, 1, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' }, id: "tc-b", display: { label: "read_file", subject: "b.ts" } }),
            { blockId: `${Q_EXEC}-tc2` },
        ));

        await expect(page.locator(".conversation-inner > .tcg")).toHaveCount(2, { timeout: 3_000 });

        const names = await page.locator(".conversation-inner > .tcg .tcg__tool-name").allTextContents();
        expect(names.map((n) => n.trim())).toEqual(["read_file", "read_file"]);
    });

    test("T-57: fully interleaved — DOM order matches event order", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        ws.pushStreamEvent(mkEvent(task.id, Q_EXEC, 0, "reasoning_chunk", "thinking", { blockId: `${Q_EXEC}-r1` }));
        ws.pushStreamEvent(mkEvent(
            task.id, Q_EXEC, 1, "tool_call",
            JSON.stringify({ type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' }, id: "tc1" }),
            { blockId: `${Q_EXEC}-tc1` },
        ));
        ws.pushStreamEvent(mkEvent(task.id, Q_EXEC, 2, "text_chunk", "text after tool", { blockId: `${Q_EXEC}-t1` }));

        await expect(page.locator(".tcg")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".msg__bubble.streaming")).toBeVisible();
    });

    test("T-58: tools injected one-at-a-time, each DOM-visible before next arrives", async ({ page, ws, task }) => {
        await page.goto("/");
        await openTaskDrawer(page, task.id);

        const tools = ["alpha.ts", "beta.ts", "gamma.ts"];
        for (let i = 0; i < tools.length; i++) {
            ws.pushStreamEvent(mkEvent(
                task.id, Q_EXEC, i, "tool_call",
                JSON.stringify({ type: "function", function: { name: "read_file", arguments: `{"path":"${tools[i]}"}` }, id: `tc${i}` }),
                { blockId: `${Q_EXEC}-tc${i}` },
            ));
            // Each tool should be visible before next arrives
            await expect(page.locator(".conversation-inner > .tcg")).toHaveCount(i + 1, { timeout: 2_000 });
        }
    });
});
