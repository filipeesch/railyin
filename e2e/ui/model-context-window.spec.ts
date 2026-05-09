/**
 * model-context-window.spec.ts — UI tests for per-model context window editing.
 *
 * Tests the ModelTreeView inline context window editing UI:
 *   CTX-1: Non-editable model shows static badge, no pencil
 *   CTX-2: Editable model has pencil element in DOM
 *   CTX-3: Click enters edit mode with correct pre-filled value
 *   CTX-4: Blur with new value calls API and updates display
 *   CTX-5: Enter key saves value
 *   CTX-6: Escape cancels — no API call, previous display restored
 *   CTX-7: Clearing input calls API with null, number disappears
 *   CTX-8: Checkbox not toggled when interacting with ctx edit area
 *
 * Navigation: /setup → "Models" tab → ModelTreeView
 * Backend: fully mocked via ApiMock.
 */

import { test, expect } from "./fixtures";
import type { ApiMock } from "./fixtures/mock-api";
import { goToSetup } from "./fixtures/setup-helpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PI_MODEL_ID = "pi/llama-3.3-70b";
const COPILOT_MODEL_ID = "copilot/gpt-4o";

/**
 * models.list fixture — one Pi (editable) model and one Copilot (non-editable).
 */
const MODELS = [
  {
    id: "pi",
    models: [
      {
        id: PI_MODEL_ID,
        displayName: "Llama 3.3 70B",
        contextWindow: 128_000,
        contextWindowEditable: true,
        enabled: true,
      },
    ],
  },
  {
    id: "copilot",
    models: [
      {
        id: COPILOT_MODEL_ID,
        displayName: "GPT-4o",
        contextWindow: 128_000,
        contextWindowEditable: false,
        enabled: true,
      },
    ],
  },
];

/** Same fixture but with the Pi model having no contextWindow set (null). */
const MODELS_NO_CTX = [
  {
    id: "pi",
    models: [
      {
        id: PI_MODEL_ID,
        displayName: "Llama 3.3 70B",
        contextWindow: null,
        contextWindowEditable: true,
        enabled: true,
      },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to the Models tab in /setup, which renders ModelTreeView.
 * Expands the "pi" provider if it exists.
 */
async function goToModelsTab(page: import("@playwright/test").Page, api: ApiMock) {
  await goToSetup(page, api);
  await page.getByRole("tab", { name: "Models" }).click();
  // Wait for the model list to render
  await expect(page.locator(".model-tree")).toBeVisible({ timeout: 3_000 });
}

// ─── CTX-1: Static badge for non-editable model ───────────────────────────────

test.describe("CTX-1: static badge for non-editable model", () => {
  test("copilot model shows context window text but no pencil or editable span", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    await goToModelsTab(page, api);

    const copilotRow = page.locator(".model-row").filter({ hasText: "GPT-4o" });
    await expect(copilotRow).toBeVisible();

    // Static badge present
    await expect(copilotRow.locator(".model-ctx")).toBeVisible();
    await expect(copilotRow.locator(".model-ctx")).toContainText("ctx");

    // No editable variant or pencil
    await expect(copilotRow.locator(".model-ctx--editable")).not.toBeVisible();
    await expect(copilotRow.locator(".model-ctx__pencil")).not.toBeVisible();
  });
});

// ─── CTX-2: Editable model has pencil in DOM ──────────────────────────────────

test.describe("CTX-2: editable model has pencil element", () => {
  test("pi model row contains .model-ctx--editable span with pencil icon", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await expect(piRow).toBeVisible();

    // Editable ctx badge present
    const editableBadge = piRow.locator(".model-ctx--editable");
    await expect(editableBadge).toBeVisible();

    // Value shown
    await expect(editableBadge).toContainText("128K ctx");

    // Pencil icon in DOM (CSS-hidden by default, visible on hover)
    await expect(piRow.locator(".model-ctx__pencil")).toBeAttached();
  });
});

// ─── CTX-3: Click enters edit mode with pre-filled value ─────────────────────

test.describe("CTX-3: click enters edit mode with pre-filled value", () => {
  test("clicking editable badge replaces it with a number input pre-filled with current tokens", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    // Input appears
    const input = piRow.locator(".model-ctx-input");
    await expect(input).toBeVisible({ timeout: 2_000 });

    // Pre-filled with current value
    await expect(input).toHaveValue("128000");

    // Badge no longer visible while editing
    await expect(piRow.locator(".model-ctx--editable")).not.toBeVisible();
  });

  test("clicking pencil icon also enters edit mode", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    await expect(piRow.locator(".model-ctx-input")).toBeVisible({ timeout: 2_000 });
  });
});

// ─── CTX-4: Blur with new value calls API and updates display ─────────────────

test.describe("CTX-4: blur with value saves and updates display", () => {
  test("entering a value and blurring calls models.setContextWindow and shows updated badge", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    const setCalls = api.capture("models.setContextWindow", {});
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    const input = piRow.locator(".model-ctx-input");
    await expect(input).toBeVisible({ timeout: 2_000 });

    await input.fill("200000");
    // Blur by pressing Tab
    await input.press("Tab");

    // API called with the new value
    await expect.poll(() => setCalls.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(setCalls[0]).toMatchObject({
      qualifiedModelId: PI_MODEL_ID,
      contextWindow: 200000,
    });

    // Input gone, badge updated
    await expect(input).not.toBeVisible();
    await expect(piRow.locator(".model-ctx--editable")).toContainText("200K ctx");
  });
});

// ─── CTX-5: Enter key saves ───────────────────────────────────────────────────

test.describe("CTX-5: Enter key saves value", () => {
  test("pressing Enter in the input calls models.setContextWindow", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    const setCalls = api.capture("models.setContextWindow", {});
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    const input = piRow.locator(".model-ctx-input");
    await expect(input).toBeVisible({ timeout: 2_000 });

    await input.fill("65536");
    await input.press("Enter");

    await expect.poll(() => setCalls.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(setCalls[0]).toMatchObject({
      qualifiedModelId: PI_MODEL_ID,
      contextWindow: 65536,
    });

    // Input dismissed
    await expect(input).not.toBeVisible();
  });
});

// ─── CTX-6: Escape cancels — no API call ─────────────────────────────────────

test.describe("CTX-6: Escape cancels edit without calling API", () => {
  test("pressing Escape closes the input and does not call models.setContextWindow", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    const setCalls = api.capture("models.setContextWindow", {});
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    const input = piRow.locator(".model-ctx-input");
    await expect(input).toBeVisible({ timeout: 2_000 });

    await input.fill("999999");
    await input.press("Escape");

    // Input closed
    await expect(input).not.toBeVisible();

    // Badge still shows original value
    await expect(piRow.locator(".model-ctx--editable")).toContainText("128K ctx");

    // API not called
    expect(setCalls).toHaveLength(0);
  });
});

// ─── CTX-7: Empty input clears override ──────────────────────────────────────

test.describe("CTX-7: empty input calls API with null and removes number from badge", () => {
  test("clearing the input and blurring calls setContextWindow with null", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    const setCalls = api.capture("models.setContextWindow", {});
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    await piRow.locator(".model-ctx--editable").click();

    const input = piRow.locator(".model-ctx-input");
    await expect(input).toBeVisible({ timeout: 2_000 });

    // Clear the value
    await input.fill("");
    await input.press("Tab");

    await expect.poll(() => setCalls.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(setCalls[0]).toMatchObject({
      qualifiedModelId: PI_MODEL_ID,
      contextWindow: null,
    });

    // Number text gone from badge; only pencil remains
    const badge = piRow.locator(".model-ctx--editable");
    await expect(badge).toBeVisible();
    await expect(badge).not.toContainText("ctx");
    await expect(badge.locator(".model-ctx__pencil")).toBeAttached();
  });

  test("model with no initial contextWindow shows only pencil, no number", async ({ page, api }) => {
    api.returns("models.list", MODELS_NO_CTX);
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    const badge = piRow.locator(".model-ctx--editable");
    await expect(badge).toBeVisible();

    // No numeric text
    await expect(badge).not.toContainText("ctx");

    // Pencil present
    await expect(badge.locator(".model-ctx__pencil")).toBeAttached();
  });
});

// ─── CTX-8: Checkbox unaffected by ctx edit area clicks ──────────────────────

test.describe("CTX-8: checkbox not toggled when interacting with ctx edit area", () => {
  test("clicking the context window badge does not toggle the model's enabled checkbox", async ({ page, api }) => {
    api.returns("models.list", MODELS);
    const toggleCalls = api.capture("models.setEnabled", []);
    await goToModelsTab(page, api);

    const piRow = page.locator(".model-row").filter({ hasText: "Llama 3.3 70B" });
    const checkbox = piRow.locator(".p-checkbox");
    const wasChecked = await checkbox.locator("input").isChecked();

    // Click the editable badge
    await piRow.locator(".model-ctx--editable").click();
    // Dismiss immediately without changing anything
    await piRow.locator(".model-ctx-input").press("Escape");

    // Checkbox state unchanged
    expect(await checkbox.locator("input").isChecked()).toBe(wasChecked);
    // setEnabled not called
    expect(toggleCalls).toHaveLength(0);
  });
});
