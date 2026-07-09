import { test, expect } from "./fixtures";
import { openTaskDrawer, openSessionDrawer } from "./fixtures";
import type { Task } from "@shared/rpc-types";

const MODEL_WITH_REASONING = {
    id: "copilot/gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    engineId: "copilot",
    modelSettings: {
        settings: [
            {
                id: "reasoningEffort",
                label: "Reasoning Effort",
                options: [
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                ],
                defaultValue: "medium",
                visible: true,
            },
        ],
    },
};

const MODEL_WITHOUT_REASONING = {
    id: "copilot/gpt-4",
    displayName: "GPT-4",
    contextWindow: 128_000,
    engineId: "copilot",
    modelSettings: {
        settings: [],
    },
};

test.describe("model settings selector", () => {
    test("is hidden when active model has no settings", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [MODEL_WITHOUT_REASONING]);
        api.handle("tasks.list", () => [{ ...task, model: MODEL_WITHOUT_REASONING.id, modelParams: [] }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-model-settings-select")).not.toBeAttached();
    });

    test("is visible for supported model and exposes provider values", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("tasks.list", () => [{ ...task, model: MODEL_WITH_REASONING.id, modelParams: [{ id: "reasoningEffort", value: "high" }] }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-model-settings-select")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".model-settings-select__value")).toContainText("high");

        await page.locator(".input-model-settings-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });
        const options = dropdown.locator(".model-settings-select__option");
        await expect(options).toHaveCount(3);
    });

    test("task chat selection calls conversations.setModelParams", async ({ page, api, task }) => {
        const reasonTask: Task = { ...task, model: MODEL_WITH_REASONING.id, modelParams: [] };
        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("tasks.list", () => [reasonTask]);

        let capturedModelParams: unknown;
        api.handle("conversations.setModelParams", ({ modelParams }) => {
            capturedModelParams = modelParams;
            return {};
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".input-model-settings-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await dropdown.locator(".model-settings-select__option:has-text('medium')").click();

        expect(capturedModelParams).toEqual([{ id: "reasoningEffort", value: "medium" }]);
    });

    test("session chat selection calls conversations.setModelParams", async ({ page, api }) => {
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
            modelParams: [],
            shellAutoApprove: false,
            approvedCommands: [],
            lastActivityAt: new Date().toISOString(),
            lastReadAt: null,
            archivedAt: null,
            createdAt: new Date().toISOString(),
        };

        api.handle("models.listEnabled", () => [MODEL_WITH_REASONING]);
        api.handle("chatSessions.list", () => [session]);
        api.handle("chatSessions.get", () => session);

        let capturedConvId: number | undefined;
        let capturedModelParams: unknown;
        api.handle("conversations.setModelParams", ({ conversationId: cid, modelParams }) => {
            capturedConvId = cid;
            capturedModelParams = modelParams;
            return {};
        });

        await page.goto("/");
        await openSessionDrawer(page, sessionId);

        await page.locator(".input-model-settings-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await dropdown.locator(".model-settings-select__option:has-text('high')").click();

        expect(capturedConvId).toBe(conversationId);
        expect(capturedModelParams).toEqual([{ id: "reasoningEffort", value: "high" }]);
    });
});
