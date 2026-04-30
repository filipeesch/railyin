import { test, expect } from "./fixtures";
import { makeBoard, makeProject, makeWorkspace } from "./fixtures/mock-data";
import { goToSetup } from "./fixtures/setup-helpers";

const MODELS = [
  {
    id: "copilot",
    models: [
      { id: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000, enabled: true },
    ],
  },
];

const TEMPLATE = { id: "delivery", name: "Delivery", columns: [], groups: [] };

/** Navigate to /setup then activate the Boards tab. */
async function goToBoards(page: import("@playwright/test").Page) {
  await page.getByRole("tab", { name: "Boards" }).click();
}

// ─── Suite B — Board list rendering ──────────────────────────────────────────

test.describe("B — board list", () => {
  test("B-1: board names and template names are visible in list", async ({ page, api }) => {
    const board = makeBoard({ name: "Q2 Delivery", template: { ...TEMPLATE, name: "Delivery" } });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace());
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await expect(page.locator(".project-item__name").filter({ hasText: "Q2 Delivery" })).toBeVisible();
    await expect(page.locator(".project-item__path").filter({ hasText: "Delivery" })).toBeVisible();
  });

  test("B-2: empty list shows hint text", async ({ page, api }) => {
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace())
      .returns("boards.list", []);
    await goToSetup(page, api);
    await goToBoards(page);
    await expect(page.getByText(/no boards yet/i)).toBeVisible();
  });

  test("B-3: edit and delete buttons visible per board", async ({ page, api }) => {
    const board = makeBoard();
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace());
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await expect(page.getByRole("button", { name: /edit board/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /delete board/i })).toBeVisible();
  });
});

// ─── Suite BA — Add board dialog ──────────────────────────────────────────────

test.describe("BA — add board dialog", () => {
  test("BA-1: dialog opens when Add board is clicked", async ({ page, api }) => {
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }));
    await goToSetup(page, api);
    await goToBoards(page);
    await page.getByRole("button", { name: /add board/i }).click();
    await expect(page.getByRole("dialog", { name: /add board/i })).toBeVisible();
  });

  test("BA-2: Add board button is disabled when name is empty", async ({ page, api }) => {
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }));
    await goToSetup(page, api);
    await goToBoards(page);
    await page.getByRole("button", { name: /add board/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const submitBtn = page.getByRole("dialog").getByRole("button", { name: /add board/i });
    await expect(submitBtn).toBeDisabled();
  });

  test("BA-3: create board calls boards.create and closes dialog", async ({ page, api }) => {
    const newBoard = makeBoard({ name: "Sprint Board" });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }))
      .returns("boards.create", newBoard);
    await goToSetup(page, api);
    await goToBoards(page);
    await page.getByRole("button", { name: /add board/i }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Sprint Board");
    await page.getByRole("dialog").getByRole("button", { name: /add board/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 });
  });

  test("BA-4: project checkboxes shown when projects exist", async ({ page, api }) => {
    const project = makeProject({ key: "my-proj", name: "My Project" });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [project])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }));
    await goToSetup(page, api);
    await goToBoards(page);
    await page.getByRole("button", { name: /add board/i }).click();
    await expect(page.getByRole("dialog").getByText("My Project")).toBeVisible();
  });
});

// ─── Suite BE — Edit board dialog ─────────────────────────────────────────────

test.describe("BE — edit board dialog", () => {
  test("BE-1: dialog pre-filled with board name", async ({ page, api }) => {
    const board = makeBoard({ name: "Q2 Board" });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }));
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /edit board/i }).click();
    await expect(page.getByRole("dialog", { name: /edit board/i })).toBeVisible();
    const nameInput = page.getByRole("dialog").getByRole("textbox");
    await expect(nameInput).toHaveValue("Q2 Board");
  });

  test("BE-3: rename calls boards.update and closes dialog", async ({ page, api }) => {
    const board = makeBoard({ name: "Old Name" });
    const updated = makeBoard({ name: "New Name" });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }))
      .returns("boards.update", updated);
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /edit board/i }).click();
    const nameInput = page.getByRole("dialog").getByRole("textbox");
    await nameInput.fill("New Name");
    await page.getByRole("dialog").getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 });
  });
});

// ─── Suite BW — Workflow change warning ───────────────────────────────────────

test.describe("BW — workflow change warning", () => {
  test("BW-1: no warning shown when taskCount is 0", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 0, workflowTemplateId: "delivery" });
    const SECOND = { id: "sprint", name: "Sprint", columns: [], groups: [] };
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE, SECOND] }));
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /edit board/i }).click();
    await page.getByRole("dialog").locator("select").selectOption("sprint");
    await expect(page.getByRole("dialog").getByText(/workflow template/i)).not.toBeVisible();
  });

  test("BW-2: warning visible when taskCount > 0 and workflow changes", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 3, workflowTemplateId: "delivery" });
    const SECOND = { id: "sprint", name: "Sprint", columns: [], groups: [] };
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE, SECOND] }));
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /edit board/i }).click();
    await page.getByRole("dialog").locator("select").selectOption("sprint");
    await expect(page.getByRole("dialog").getByText(/columns to mismatch/i)).toBeVisible();
  });
});

// ─── Suite BD — Delete board flow ─────────────────────────────────────────────

test.describe("BD — delete board", () => {
  test("BD-1: shows toast for board with tasks (no dialog)", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 2 });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace());
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /delete board/i }).click();
    await expect(page.locator(".p-toast")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("dialog", { name: /delete board/i })).not.toBeVisible();
  });

  test("BD-2: shows confirm dialog for board with no tasks", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 0 });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace());
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /delete board/i }).click();
    await expect(page.getByRole("dialog", { name: /delete board/i })).toBeVisible({ timeout: 3_000 });
  });

  test("BD-3: confirm delete calls boards.delete and removes from list", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 0 });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace())
      .returns("boards.delete", {});
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /delete board/i }).click();
    await page.getByRole("dialog", { name: /delete board/i }).getByRole("button", { name: /delete/i }).click();
    await expect(page.getByRole("dialog", { name: /delete board/i })).not.toBeVisible({ timeout: 5_000 });
  });
});

// ─── Suite BER — Error state handling ────────────────────────────────────────

test.describe("BER — error handling", () => {
  test("BER-1: boards.create error shown in dialog", async ({ page, api }) => {
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace({ workflows: [TEMPLATE] }));
    api.handle("boards.create", () => { throw new Error("Name already taken"); });
    await goToSetup(page, api);
    await goToBoards(page);
    await page.getByRole("button", { name: /add board/i }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Duplicate");
    await page.getByRole("dialog").getByRole("button", { name: /add board/i }).click();
    await expect(page.getByRole("dialog").getByText(/name already taken/i)).toBeVisible({ timeout: 3_000 });
  });

  test("BER-3: boards.delete error shown in confirm dialog", async ({ page, api }) => {
    const board = makeBoard({ taskCount: 0 });
    api
      .returns("models.list", MODELS)
      .returns("projects.list", [])
      .returns("workspace.list", [makeWorkspace()])
      .returns("workspace.getConfig", makeWorkspace());
    api.handle("boards.delete", () => { throw new Error("Database error"); });
    await goToSetup(page, api);
    api.returns("boards.list", [board]);
    await goToBoards(page);
    await page.getByRole("button", { name: /delete board/i }).click();
    await page.getByRole("dialog", { name: /delete board/i }).getByRole("button", { name: /^delete$/i }).click();
    await expect(page.getByRole("dialog").getByText(/database error/i)).toBeVisible({ timeout: 3_000 });
  });
});
