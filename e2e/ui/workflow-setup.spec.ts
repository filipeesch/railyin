import { test, expect } from "./fixtures";
import { makeBoard, makeWorkspace } from "./fixtures/mock-data";
import { goToSetup } from "./fixtures/setup-helpers";
import type { WorkflowSummary } from "@shared/rpc-types";

const MODELS = [
  {
    id: "copilot",
    models: [
      { id: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000, enabled: true },
    ],
  },
];

function wf(overrides: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: "delivery",
    name: "Delivery",
    boardCount: 0,
    deletable: true,
    undeletableReason: null,
    ...overrides,
  };
}

/** Register the baseline setup-screen mocks. */
function baseline(api: import("./fixtures/mock-api").ApiMock) {
  api
    .returns("models.list", MODELS)
    .returns("projects.list", [])
    .returns("workspace.list", [makeWorkspace()])
    .returns("workspace.getConfig", makeWorkspace());
}

/** Navigate to /setup then activate the Workflows tab. */
async function goToWorkflows(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Workflows" }).click();
}

// ─── Suite WT — Tab presence and order ───────────────────────────────────────

test.describe("WT — workflows tab", () => {
  test("WT-1: Workflows tab exists immediately before the Boards tab", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", []);
    await goToSetup(page, api);

    const tabs = page.getByRole("tab");
    const names = await tabs.allInnerTexts();
    const wfIdx = names.findIndex((n) => /workflows/i.test(n));
    const boardsIdx = names.findIndex((n) => /^boards$/i.test(n.trim()));
    expect(wfIdx).toBeGreaterThanOrEqual(0);
    expect(boardsIdx).toBeGreaterThanOrEqual(0);
    expect(wfIdx).toBe(boardsIdx - 1);
  });
});

// ─── Suite W — Workflow list rendering ───────────────────────────────────────

test.describe("W — workflow list", () => {
  test("W-1: each row shows name + id and pencil/trash buttons", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [
      wf({ id: "delivery", name: "Delivery" }),
      wf({ id: "sprint", name: "Sprint" }),
    ]);
    await goToSetup(page, api);
    await goToWorkflows(page);

    await expect(page.locator(".project-item__name").filter({ hasText: "Delivery" })).toBeVisible();
    await expect(page.locator(".project-item__path").filter({ hasText: "delivery" })).toBeVisible();
    await expect(page.locator(".project-item__name").filter({ hasText: "Sprint" })).toBeVisible();
    await expect(page.locator(".project-item__path").filter({ hasText: "sprint" })).toBeVisible();

    await expect(page.getByRole("button", { name: /edit workflow/i })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /delete workflow/i })).toHaveCount(2);
  });
});

// ─── Suite WD — Delete workflow flow ─────────────────────────────────────────

test.describe("WD — delete workflow", () => {
  test("WD-1: a referenced workflow has a visible but disabled trash button", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [
      wf({ id: "delivery", name: "Delivery", deletable: false, boardCount: 2, undeletableReason: "Used by 2 boards" }),
    ]);
    await goToSetup(page, api);
    await goToWorkflows(page);

    const trash = page.getByRole("button", { name: /delete workflow/i });
    await expect(trash).toBeVisible();
    await expect(trash).toBeDisabled();
  });

  test("WD-2: a non-deletable last workflow has a disabled trash button", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [
      wf({ id: "delivery", name: "Delivery", deletable: false, undeletableReason: "Cannot delete the last workflow" }),
    ]);
    await goToSetup(page, api);
    await goToWorkflows(page);

    const trash = page.getByRole("button", { name: /delete workflow/i });
    await expect(trash).toBeVisible();
    await expect(trash).toBeDisabled();
  });

  test("WD-3: clicking trash on a deletable workflow opens the confirmation dialog", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "sprint", name: "Sprint", deletable: true })]);
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /delete workflow/i }).click();
    await expect(page.getByRole("dialog", { name: /delete workflow/i })).toBeVisible();
  });

  test("WD-4: confirming delete calls workflow.delete", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "sprint", name: "Sprint", deletable: true })]);
    const deleteCalls = api.capture("workflow.delete", { ok: true });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /delete workflow/i }).click();
    await page.getByRole("dialog", { name: /delete workflow/i }).getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByRole("dialog", { name: /delete workflow/i })).not.toBeVisible({ timeout: 5_000 });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toMatchObject({ templateId: "sprint" });
  });

  test("WD-5: cancelling the confirmation makes no workflow.delete call", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "sprint", name: "Sprint", deletable: true })]);
    const deleteCalls = api.capture("workflow.delete", { ok: true });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /delete workflow/i }).click();
    const dialog = page.getByRole("dialog", { name: /delete workflow/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    expect(deleteCalls).toHaveLength(0);
  });
});

// ─── Suite WA — Add workflow dialog ──────────────────────────────────────────

test.describe("WA — add workflow", () => {
  test("WA-1: clicking Add workflow opens the Add Workflow dialog", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", []);
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /add workflow/i }).click();
    await expect(page.getByRole("dialog", { name: /add workflow/i })).toBeVisible();
  });

  test("WA-2: the create button is disabled while the name is empty", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", []);
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /add workflow/i }).click();
    const dialog = page.getByRole("dialog", { name: /add workflow/i });
    await expect(dialog).toBeVisible();
    const createBtn = dialog.getByRole("button", { name: /create workflow/i });
    await expect(createBtn).toBeDisabled();

    await dialog.getByRole("textbox").fill("My Flow");
    await expect(createBtn).toBeEnabled();
  });

  test("WA-3: submitting a name calls workflow.create and refreshes the list", async ({ page, api }) => {
    baseline(api);
    let listCalls = 0;
    api.handle("workflow.list", () => {
      listCalls += 1;
      return listCalls >= 2 ? [wf({ id: "my-flow", name: "My Flow" })] : [];
    });
    const createCalls = api.capture("workflow.create", { id: "my-flow" });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /add workflow/i }).click();
    const dialog = page.getByRole("dialog", { name: /add workflow/i });
    await dialog.getByRole("textbox").fill("My Flow");
    await dialog.getByRole("button", { name: /create workflow/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({ name: "My Flow" });
    await expect(page.locator(".project-item__name").filter({ hasText: "My Flow" })).toBeVisible();
  });
});

// ─── Suite WE — Workflow editor overlay ──────────────────────────────────────

test.describe("WE — workflow editor overlay", () => {
  const YAML = "id: delivery\nname: Delivery\ncolumns: []\n";

  test("WE-1: clicking pencil opens the editor overlay with the workflow name", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "delivery", name: "Delivery" })]);
    api.returns("workflow.getYaml", { yaml: YAML });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /edit workflow/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".workflow-editor-overlay__title")).toContainText("Delivery");
  });

  test("WE-2: Save & Reload calls workflow.saveYaml", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "delivery", name: "Delivery" })]);
    api.returns("workflow.getYaml", { yaml: YAML });
    const saveCalls = api.capture("workflow.saveYaml", { ok: true });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /edit workflow/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /save & reload/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).not.toBeVisible({ timeout: 10_000 });
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toMatchObject({ templateId: "delivery" });
  });

  test("WE-3: Cancel closes the overlay without calling workflow.saveYaml", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "delivery", name: "Delivery" })]);
    api.returns("workflow.getYaml", { yaml: YAML });
    const saveCalls = api.capture("workflow.saveYaml", { ok: true });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /edit workflow/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).toBeVisible({ timeout: 10_000 });
    await page.locator(".workflow-editor-overlay").getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).not.toBeVisible({ timeout: 10_000 });
    expect(saveCalls).toHaveLength(0);
  });

  test("WE-4: pressing Escape closes the overlay without calling workflow.saveYaml", async ({ page, api }) => {
    baseline(api);
    api.returns("workflow.list", [wf({ id: "delivery", name: "Delivery" })]);
    api.returns("workflow.getYaml", { yaml: YAML });
    const saveCalls = api.capture("workflow.saveYaml", { ok: true });
    await goToSetup(page, api);
    await goToWorkflows(page);

    await page.getByRole("button", { name: /edit workflow/i }).click();
    await expect(page.locator(".workflow-editor-overlay")).toBeVisible({ timeout: 10_000 });
    await page.locator(".workflow-editor-overlay").press("Escape");
    await expect(page.locator(".workflow-editor-overlay")).not.toBeVisible({ timeout: 10_000 });
    expect(saveCalls).toHaveLength(0);
  });
});

// ─── Suite WB — Board header has no workflow-edit pencil ─────────────────────

test.describe("WB — board header", () => {
  test("WB-1: the board header has no workflow-edit pencil button", async ({ page, api }) => {
    api.returns("boards.list", [makeBoard()]);
    await page.goto("/");
    await expect(page.locator(".board-header")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".board-header").getByRole("button", { name: /edit workflow/i })).toHaveCount(0);
  });
});

// ─── Suite WR — workflow.reloaded push event ─────────────────────────────────

test.describe("WR — workflow reloaded push", () => {
  test("WR-1: workflow.reloaded push triggers a re-fetch of workflow.list", async ({ page, api, ws }) => {
    baseline(api);
    const listCalls = api.capture("workflow.list", [wf({ id: "delivery", name: "Delivery" })]);
    await goToSetup(page, api);
    await goToWorkflows(page);

    await expect(page.locator(".project-item__name").filter({ hasText: "Delivery" })).toBeVisible();
    const callsBefore = listCalls.length;

    ws.push({ type: "workflow.reloaded", payload: {} });
    await expect.poll(() => listCalls.length, { timeout: 5_000 }).toBeGreaterThan(callsBefore);
  });
});
