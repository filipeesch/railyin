/**
 * sampling-preset-select.spec.ts — Sampling preset selector UI tests.
 *
 * Suites:
 *   X — Sampling preset selector (task chat & session chat)
 */

import { test, expect } from "./fixtures";
import { openTaskDrawer, openSessionDrawer } from "./fixtures";
import type { Task } from "@shared/rpc-types";

const PI_MODEL = {
    id: "pi/lmstudio/qwen3-8b",
    displayName: "Qwen3-8B",
    contextWindow: 8192,
    engineId: "pi",
    availablePresets: [
        { name: "balanced", params: { temperature: 0.7, top_p: 0.9 } },
        { name: "creative", params: { temperature: 1.1, top_p: 0.95 } },
        { name: "precise", params: { temperature: 0.2, top_p: 0.8 } },
    ],
};

const NON_PI_MODEL = {
    id: "copilot/gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    engineId: "copilot",
};

// ─── Suite X — Sampling preset selector ───────────────────────────────────────

test.describe("X — Sampling preset selector", () => {

    // ── X-60: selector hidden for non-Pi model ───────────────────────────────

    test("X-60: preset selector is hidden when a non-Pi model is active", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [NON_PI_MODEL]);
        api.handle("tasks.list", () => [{ ...task, model: NON_PI_MODEL.id }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-preset-select")).not.toBeAttached();
    });

    // ── X-61: selector hidden for Pi model with no presets ───────────────────

    test("X-61: preset selector is hidden when Pi model has no presets configured", async ({ page, api, task }) => {
        const piNoPresets = { id: "pi/lmstudio/qwen3-8b", displayName: "Qwen3-8B", contextWindow: 8192, engineId: "pi" };
        api.handle("models.listEnabled", () => [piNoPresets]);
        api.handle("tasks.list", () => [{ ...task, model: piNoPresets.id }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-preset-select")).not.toBeAttached();
    });

    // ── X-62: selector visible for Pi model with presets ─────────────────────

    test("X-62: preset selector is visible when Pi model with presets is active", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [{ ...task, model: PI_MODEL.id }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".input-preset-select")).toBeVisible({ timeout: 3_000 });
        // Default value is "Default"
        await expect(page.locator(".preset-select__value")).toContainText("Default");
    });

    // ── X-63: open dropdown shows Default + preset options ──────────────────────

    test("X-63: open dropdown shows Default and all available presets", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [{ ...task, model: PI_MODEL.id }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".input-preset-select").click();

        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });

        // Default option with description
        await expect(dropdown.locator(".preset-select__option-title").first()).toContainText("Default");
        await expect(dropdown.locator(".preset-select__option-params").first()).toContainText("Set by the workflow column");

        // Named presets
        const optionTitles = dropdown.locator(".preset-select__option-title");
        await expect(optionTitles).toHaveCount(4); // Default + 3 presets
        await expect(optionTitles.nth(1)).toContainText("balanced");
        await expect(optionTitles.nth(2)).toContainText("creative");
        await expect(optionTitles.nth(3)).toContainText("precise");
    });

    // ── X-64: preset option shows parameter details ───────────────────────────

    test("X-64: preset option row shows temperature and top_p details", async ({ page, api, task }) => {
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [{ ...task, model: PI_MODEL.id }]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".input-preset-select").click();

        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });

        // "balanced" option params: temp 0.7, top_p 0.9
        const balancedParams = dropdown.locator(".preset-select__option").nth(1).locator(".preset-select__option-params");
        await expect(balancedParams).toContainText("temp: 0.7");
        await expect(balancedParams).toContainText("top_p: 0.9");
    });

    // ── X-65: selecting a preset calls setSamplingPreset ─────────────────────

    test("X-65: selecting a preset calls conversations.setSamplingPreset and updates UI", async ({ page, api, ws, task }) => {
        const piTask: Task = { ...task, model: PI_MODEL.id, samplingPresetOverride: null };
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [piTask]);

        let capturedPreset: string | null | undefined;
        api.handle("conversations.setSamplingPreset", ({ presetName }) => {
            capturedPreset = presetName;
            return {};
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await page.locator(".input-preset-select").click();

        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });

        await dropdown.locator(".preset-select__option-title:text('creative')").click();

        // UI reflects the new selection
        await expect(page.locator(".preset-select__value")).toContainText("creative", { timeout: 2_000 });

        // RPC was called with the right preset
        expect(capturedPreset).toBe("creative");
    });

    // ── X-66: selecting Default sends null preset ────────────────────────────────

    test("X-66: selecting Default sends null to setSamplingPreset", async ({ page, api, task }) => {
        const piTask: Task = { ...task, model: PI_MODEL.id, samplingPresetOverride: "precise" };
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [piTask]);

        let capturedPreset: string | null | undefined;
        api.handle("conversations.setSamplingPreset", ({ presetName }) => {
            capturedPreset = presetName;
            return {};
        });

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        // Starts with "precise"
        await expect(page.locator(".preset-select__value")).toContainText("precise", { timeout: 3_000 });

        await page.locator(".input-preset-select").click();

        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });
        await dropdown.locator(".preset-select__option-title:text('Default')").click();

        await expect(page.locator(".preset-select__value")).toContainText("Default", { timeout: 2_000 });
        expect(capturedPreset).toBeNull();
    });

    // ── X-67: override persists after task.updated push ───────────────────────

    test("X-67: preset override shown correctly after task.updated push", async ({ page, api, ws, task }) => {
        const piTask: Task = { ...task, model: PI_MODEL.id, samplingPresetOverride: null };
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("tasks.list", () => [piTask]);

        await page.goto("/");
        await openTaskDrawer(page, task.id);

        await expect(page.locator(".preset-select__value")).toContainText("Default", { timeout: 3_000 });

        // Backend pushes updated task with override set
        ws.push({ type: "task.updated", payload: { ...piTask, samplingPresetOverride: "balanced" } });

        await expect(page.locator(".preset-select__value")).toContainText("balanced", { timeout: 3_000 });
    });

    // ── X-68: selector in session chat (SessionChatView) ─────────────────────

    test("X-68: preset selector is visible in session chat when Pi model is active", async ({ page, api }) => {
        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("chatSessions.list", () => [
            { id: 5, workspaceKey: "test-workspace", title: "My Session", status: "idle", conversationId: 5, model: PI_MODEL.id, enabledMcpTools: null, samplingPresetOverride: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString() },
        ]);
        api.handle("chatSessions.get", () => ({
            id: 5, workspaceKey: "test-workspace", title: "My Session", status: "idle", conversationId: 5, model: PI_MODEL.id, enabledMcpTools: null, samplingPresetOverride: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString(),
        }));

        await page.goto("/");
        await openSessionDrawer(page, 5);

        await expect(page.locator(".input-preset-select")).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".preset-select__value")).toContainText("Default");
    });

    // ── X-69: session chat — selecting preset calls setSamplingPreset ─────────

    test("X-69: selecting preset in session chat calls setSamplingPreset", async ({ page, api }) => {
        const sessionId = 5;
        const conversationId = 5;

        api.handle("models.listEnabled", () => [PI_MODEL]);
        api.handle("chatSessions.list", () => [
            { id: sessionId, workspaceKey: "test-workspace", title: "My Session", status: "idle", conversationId, model: PI_MODEL.id, enabledMcpTools: null, samplingPresetOverride: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString() },
        ]);
        api.handle("chatSessions.get", () => ({
            id: sessionId, workspaceKey: "test-workspace", title: "My Session", status: "idle", conversationId, model: PI_MODEL.id, enabledMcpTools: null, samplingPresetOverride: null, lastActivityAt: new Date().toISOString(), lastReadAt: null, archivedAt: null, createdAt: new Date().toISOString(),
        }));

        let capturedConvId: number | undefined;
        let capturedPreset: string | null | undefined;
        api.handle("conversations.setSamplingPreset", ({ conversationId: cid, presetName }) => {
            capturedConvId = cid;
            capturedPreset = presetName;
            return {};
        });

        await page.goto("/");
        await openSessionDrawer(page, sessionId);

        await page.locator(".input-preset-select").click();
        const dropdown = page.locator(".p-select-overlay, .p-dropdown-panel");
        await expect(dropdown).toBeVisible({ timeout: 2_000 });
        await dropdown.locator(".preset-select__option-title:text('precise')").click();

        await expect(page.locator(".preset-select__value")).toContainText("precise", { timeout: 2_000 });
        expect(capturedConvId).toBe(conversationId);
        expect(capturedPreset).toBe("precise");
    });
});
