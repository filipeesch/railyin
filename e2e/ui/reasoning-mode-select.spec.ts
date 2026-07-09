import { test, expect } from "./fixtures";
import { openTaskDrawer, openSessionDrawer } from "./fixtures";
import type { Task } from "@shared/rpc-types";

const MODEL_WITH_REASONING = {
    id: "copilot/gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    engineId: "copilot",
    modelSettings: {
        reasoningMode: {
            supportedValues: ["low", "medium", "high"],
            defaultValue: "medium",
            visible: true,
        },
    },
};

const MODEL_WITHOUT_REASONING = {
    id: "copilot/gpt-4",
    displayName: "GPT-4",
    contextWindow: 128_000,
    engineId: "copilot",
    modelSettings: {
        reasoningMode: {
            supportedValues: [],
            defaultValue: null,
            visible: false,
        },
    },
};

test.describe("reasoning mode selector", () => {
    test("is hidden when active model has no supported values", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [MODEL_WITHOUT_REASONING]);
        api.handle("tasks.list", () => [{ ...task, model: MODEL_WITHOUT_REASONING.id, reasoningModeOverride: null }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-reasoning-mode-select")).not.toBeAttached();
    });

    test("is visible for supported model and exposes provider values", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("tasks.list", () => [{ ...task, model: MODEL_WITH_REASONING.id, reasoningModeOverride: "high" }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-reasoning-mode-select")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".reasoning-mode-select__value")).toContainText("high");

        await page.locator(".input-reasoning-mode-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });
        const titles = dropdown.locator(".reasoning-mode-select__option-title");
        await expect(titles).toHaveCount(4);
        await expect(titles.nth(0)).toContainText("Default");
        await expect(titles.nth(1)).toContainText("low");
        await expect(titles.nth(2)).toContainText("medium");
        await expect(titles.nth(3)).toContainText("high");
    });

    test("task chat selection calls conversations.setReasoningMode", async ({ page, api, task }) => {
        const reasonTask: Task = { ...task, model: MODEL_WITH_REASONING.id, reasoningModeOverride: null };
        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("tasks.list", () => [reasonTask]);

        let capturedReasoningMode: string | null | undefined;
        api.handle("conversations.setReasoningMode", ({ reasoningMode }) => {
            capturedReasoningMode = reasoningMode;
            return {};
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".input-reasoning-mode-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await dropdown.locator(".reasoning-mode-select__option-title:text('medium')").click();

        await expect(page.locator(".reasoning-mode-select__value")).toContainText("medium", { timeout: 2_000 });
        expect(capturedReasoningMode).toBe("medium");
    });

    test("session chat selection calls conversations.setReasoningMode", async ({ page, api }) => {
        const sessionId = 9;
        const conversationId = 11;
        const session = {
            id: sessionId,
            workspaceKey: "test-workspace",
            title: "Session",
            status: "idle",
            conversationId,
            model: MODEL_WITH_REASONING.id,
            enabledMcpTools: null,
            samplingPresetOverride: null,
            reasoningModeOverride: null,
            lastActivityAt: new Date().toISOString(),
            lastReadAt: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
        };

        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("chatSessions.list", () => [session]);
        api.handle("chatSessions.get", () => session);

        let capturedConvId: number | undefined;
        let capturedReasoningMode: string | null | undefined;
        api.handle("conversations.setReasoningMode", ({ conversationId: cid, reasoningMode }) => {
            capturedConvId = cid;
            capturedReasoningMode = reasoningMode;
            return {};
        });

        await page.goto("/");
        await openSessionDrawer(page, sessionId);

        await page.locator(".input-reasoning-mode-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await dropdown.locator(".reasoning-mode-select__option-title:text('high')").click();

        await expect(page.locator(".reasoning-mode-select__value")).toContainText("high", { timeout: 2_000 });
        expect(capturedConvId).toBe(conversationId);
        expect(capturedReasoningMode).toBe("high");
    });
});
