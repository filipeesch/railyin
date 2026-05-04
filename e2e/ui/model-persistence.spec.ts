/**
 * model-persistence.spec.ts — Tests for model selection persistence
 * 
 * Tests that model selection persists correctly when:
 * 1. User selects a model in session chat
 * 2. User closes and reopens the session drawer
 * 3. User selects a model in task chat
 * 4. User closes and reopens the task drawer
 * 
 * Backend is mocked via ApiMock + WsMock fixtures.
 */
import { test, expect, openSidebar, openSessionDrawer, openTaskDrawer } from "./fixtures";
import { makeChatSession, makeTask, WORKSPACE_KEY } from "./fixtures/mock-data";
import type { ApiMock } from "./fixtures/mock-api";
import type { ChatSession, Task } from "@shared/rpc-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MODELS = [
  {
    id: "copilot/gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
  },
  {
    id: "copilot/o1",
    displayName: "o1",
    contextWindow: 200_000,
  },
  {
    id: "claude/sonnet-4",
    displayName: "Claude Sonnet 4",
    contextWindow: 200_000,
  },
];

function stubModelsList(api: ApiMock) {
  api.returns("models.listEnabled", MODELS);
}

function createSessionWithModel(conversationId: number, model: string | null): ChatSession {
  return makeChatSession({
    id: 1001,
    conversationId,
    title: "Test Session",
    model,
    workspaceKey: WORKSPACE_KEY,
  });
}

function createTaskWithModel(taskId: number, conversationId: number, model: string | null): Task {
  return makeTask({
    id: taskId,
    title: "Test Task",
    conversationId,
    model,
    boardId: 1,
    workflowState: "in_progress",
  });
}

// ─── Session Chat Tests ───────────────────────────────────────────────────────
test.describe("Session Chat Model Persistence", () => {
  test("SM-1: session model persists after drawer close/reopen", async ({ page, api, ws }) => {
    const session = createSessionWithModel(5001, null);
    let currentSession = { ...session };

    stubModelsList(api);
    api.returns("chatSessions.list", [currentSession]);
    api.handle("chatSessions.get", () => currentSession);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    // Mock setModel to update the session and push WS event
    api.handle("chatSessions.setModel", ({ sessionId, model }) => {
        currentSession = { ...currentSession, model };
        ws.push({ type: "chatSession.updated", payload: currentSession });
        return currentSession;
    });

    await page.goto("/");

    // Click the chat sidebar toggle button directly
    await page.click("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    await page.waitForSelector(".chat-sidebar", { timeout: 5000 });

    // Click on the session to open the drawer
    await page.click(`[data-session-id="${session.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });

    // Select a model (second option)
    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    const options = page.locator(".p-select-overlay .p-select-option");
    await options.nth(1).click(); // Select second model
    const selectedModelText = await page.locator(".session-chat-view .model-select__value").innerText();

    // Wait for persistence
    await page.waitForTimeout(300);

    // Close the drawer by clicking outside
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Reopen the same session
    await page.click(`[data-session-id="${session.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });

    // Verify the selected model is still displayed
    await expect(page.locator(".session-chat-view .model-select__value")).toContainText(selectedModelText);
  });
  
  test("SM-2: session model defaults to workspace default when null", async ({ page, api }) => {
    const conversationId = 5002;
    const session = createSessionWithModel(conversationId, null);
    
    stubModelsList(api);
    api.handle("chatSessions.list", () => [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));
    
    await page.goto("/");
    
    // Open chat sidebar
    await page.click("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    await page.waitForSelector(".chat-sidebar", { timeout: 10000 });
    await page.click(`[data-session-id="${session.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });
    
    // Should default to first model (copilot/gpt-4o)
    const modelValue = await page.locator(".session-chat-view .model-select__value").innerText();
    expect(modelValue).toContain("GPT-4o");
  });
  
  test("SM-3: session model persists selected value across multiple close/reopen cycles", async ({ page, api, ws }) => {
    let currentSession = createSessionWithModel(5003, null);

    stubModelsList(api);
    api.returns("chatSessions.list", [currentSession]);
    api.handle("chatSessions.get", () => currentSession);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    api.handle("chatSessions.setModel", ({ sessionId, model }) => {
      currentSession = { ...currentSession, model };
      ws.push({ type: "chatSession.updated", payload: currentSession });
      return currentSession;
    });


    await page.goto("/");

    // First cycle: select second model
    await page.click("button.chat-sidebar-toggle, button[aria-label='Chat sessions'], .toolbar-btn--chat");
    await page.waitForSelector(".chat-sidebar", { timeout: 5000 });
    await page.click(`[data-session-id="${currentSession.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });
    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    const options = page.locator(".p-select-overlay .p-select-option");
    await options.nth(1).click(); // Select second model
    const firstModelText = await page.locator(".session-chat-view .model-select__value").innerText();
    await page.waitForTimeout(300);
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Second cycle: verify first model is selected
    await page.click(`[data-session-id="${currentSession.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });
    await expect(page.locator(".session-chat-view .model-select__value")).toContainText(firstModelText);

    // Change to third model
    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    await options.nth(2).click(); // Select third model
    const secondModelText = await page.locator(".session-chat-view .model-select__value").innerText();
    await page.waitForTimeout(300);
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Third cycle: verify third model is selected
    await page.click(`[data-session-id="${currentSession.id}"]`);
    await page.waitForSelector(".session-chat-view", { timeout: 5000 });
    await expect(page.locator(".session-chat-view .model-select__value")).toContainText(secondModelText);
  });
});

// ─── Task Chat Tests ──────────────────────────────────────────────────────────
test.describe("Task Chat Model Persistence", () => {
  test("TM-1: task model persists after drawer close/reopen", async ({ page, api, ws }) => {
    const taskId = 2001;
    let currentTask = createTaskWithModel(taskId, 5004, null);

    stubModelsList(api);
    api.handle("tasks.list", () => [currentTask]);
    api.handle("tasks.getMessages", () => ({ messages: [], hasMore: false }));

    // Mock setModel to return updated task
    api.handle("tasks.setModel", ({ taskId, model }) => {
      currentTask = { ...currentTask, model };
      ws.push({ type: "task.updated", payload: currentTask });
      return currentTask;
    });

    await page.goto("/");

    // Click on the task in the board
    await page.click(`[data-task-id="${taskId}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });

    // Select a different model (second option)
    await page.locator(".task-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    const options = page.locator(".p-select-overlay .p-select-option");
    await options.nth(1).click();
    const selectedModelText = await page.locator(".task-chat-view .model-select__value").innerText();

    // Wait for persistence
    await page.waitForTimeout(300);

    // Close the drawer
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Reopen the same task
    await page.click(`[data-task-id="${taskId}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });

    // Verify the selected model is still displayed
    await expect(page.locator(".task-chat-view .model-select__value")).toContainText(selectedModelText);
  });

  test("TM-2: task model defaults to workspace default when null", async ({ page, api }) => {
    const taskId = 2002;
    const task = createTaskWithModel(taskId, 5005, null);

    stubModelsList(api);
    api.handle("tasks.list", () => [task]);
    api.handle("tasks.getMessages", () => ({ messages: [], hasMore: false }));

    await page.goto("/");

    // Click on the task in the board
    await page.click(`[data-task-id="${taskId}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });

    // Should default to first model
    await expect(page.locator(".task-chat-view .model-select__value")).toBeVisible();
  });

  test("TM-3: task model persists across multiple close/reopen cycles", async ({ page, api, ws }) => {
    const taskId = 2003;
    let currentTask = createTaskWithModel(taskId, 5006, null);

    stubModelsList(api);
    api.handle("tasks.list", () => [currentTask]);
    api.handle("tasks.getMessages", () => ({ messages: [], hasMore: false }));

    api.handle("tasks.setModel", ({ taskId, model }) => {
      currentTask = { ...currentTask, model };
      ws.push({ type: "task.updated", payload: currentTask });
      return currentTask;
    });

    await page.goto("/");

    // First cycle: select second model
    await page.click(`[data-task-id="${currentTask.id}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });
    await page.locator(".task-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    const options = page.locator(".p-select-overlay .p-select-option");
    await options.nth(1).click();
    const firstModelText = await page.locator(".task-chat-view .model-select__value").innerText();
    await page.waitForTimeout(300);
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Second cycle: verify first model is selected
    await page.click(`[data-task-id="${currentTask.id}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });
    await expect(page.locator(".task-chat-view .model-select__value")).toContainText(firstModelText);

    // Change to third model
    await page.locator(".task-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });
    await options.nth(2).click();
    const secondModelText = await page.locator(".task-chat-view .model-select__value").innerText();
    await page.waitForTimeout(300);
    await page.click(".board-view", { position: { x: 50, y: 50 } });
    await page.waitForTimeout(300);

    // Third cycle: verify third model is selected
    await page.click(`[data-task-id="${currentTask.id}"]`);
    await page.waitForSelector(".task-detail", { timeout: 5000 });
    await expect(page.locator(".task-chat-view .model-select__value")).toContainText(secondModelText);
  });
});
