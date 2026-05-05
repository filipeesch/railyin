/**
 * model-picker-multi-engine.spec.ts — Tests for multi-engine model picker grouping
 *
 * Tests that the model picker groups models by engine when multiple engines
 * are configured, and renders without groups when only one engine is present.
 *
 * All backend traffic is mocked via ApiMock + WsMock fixtures.
 */
import { test, expect, openSessionDrawer } from "./fixtures";
import { makeChatSession, makeTask, WORKSPACE_KEY } from "./fixtures/mock-data";
import type { ApiMock } from "./fixtures/mock-api";

// ─── Model fixtures ────────────────────────────────────────────────────────────

const MULTI_ENGINE_MODELS = [
  { id: "copilot/gpt-4o",              displayName: "GPT-4o",         contextWindow: 128_000, engineId: "copilot" },
  { id: "copilot/gpt-4.1",             displayName: "GPT-4.1",        contextWindow: 128_000, engineId: "copilot" },
  { id: "claude/claude-sonnet-4-5",    displayName: "Claude Sonnet",  contextWindow: 200_000, engineId: "claude"  },
];

const SINGLE_ENGINE_MODELS = [
  { id: "copilot/gpt-4o",  displayName: "GPT-4o",  contextWindow: 128_000, engineId: "copilot" },
  { id: "copilot/gpt-4.1", displayName: "GPT-4.1", contextWindow: 128_000, engineId: "copilot" },
];

function stubMultiEngine(api: ApiMock) {
  api.returns("models.listEnabled", MULTI_ENGINE_MODELS);
}

function stubSingleEngine(api: ApiMock) {
  api.returns("models.listEnabled", SINGLE_ENGINE_MODELS);
}

// ─── MP-1: Group headers appear when multiple engines are configured ────────

test.describe("MP-1: Engine group headers when multiple engines", () => {
  test("model picker shows engine group headers for multi-engine model list", async ({ page, api }) => {
    const session = makeChatSession({
      id: 2001,
      conversationId: 6001,
      title: "Multi-engine session",
      model: null,
      workspaceKey: WORKSPACE_KEY,
    });

    stubMultiEngine(api);
    api.returns("chatSessions.list", [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Open the model picker dropdown
    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

    // Group headers should be visible for each engine
    const groupHeaders = page.locator(".p-select-overlay .model-select__group-header");
    await expect(groupHeaders).toHaveCount(2);

    const texts = await groupHeaders.allInnerTexts();
    expect(texts).toContain("copilot");
    expect(texts).toContain("claude");
  });
});

// ─── MP-2: No group headers when single engine ─────────────────────────────

test.describe("MP-2: No group headers when single engine", () => {
  test("model picker shows no engine group headers for single-engine model list", async ({ page, api }) => {
    const session = makeChatSession({
      id: 2002,
      conversationId: 6002,
      title: "Single-engine session",
      model: null,
      workspaceKey: WORKSPACE_KEY,
    });

    stubSingleEngine(api);
    api.returns("chatSessions.list", [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

    // No group headers should be visible for single-engine list
    await expect(page.locator(".p-select-overlay .model-select__group-header")).toHaveCount(0);
  });
});

// ─── MP-3: Can select model from cross-engine picker ──────────────────────

test.describe("MP-3: Cross-engine model selection works", () => {
  test("user can select a claude model from the grouped picker", async ({ page, api, ws }) => {
    let session = makeChatSession({
      id: 2003,
      conversationId: 6003,
      title: "Cross-engine selection",
      model: null,
      workspaceKey: WORKSPACE_KEY,
    });

    stubMultiEngine(api);
    api.returns("chatSessions.list", [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));
    api.handle("chatSessions.setModel", ({ model }) => {
      session = { ...session, model };
      ws.push({ type: "chatSession.updated", payload: session });
      return session;
    });

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    // Open model picker and select Claude Sonnet
    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

    // Find and click Claude Sonnet option
    await page.locator(".p-select-overlay .p-select-option", { hasText: "Claude Sonnet" }).click();

    // Verify the selected model reflects Claude
    await expect(page.locator(".session-chat-view .model-select__value")).toContainText("Claude Sonnet");
  });
});

// ─── MP-4: Search filter works across engine groups ────────────────────────

test.describe("MP-4: Search filter works across engine groups", () => {
  test("typing in search box filters models across all engines", async ({ page, api }) => {
    const session = makeChatSession({
      id: 2004,
      conversationId: 6004,
      title: "Filter session",
      model: null,
      workspaceKey: WORKSPACE_KEY,
    });

    stubMultiEngine(api);
    api.returns("chatSessions.list", [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

    // Type in the filter input to search for "Claude"
    const filterInput = page.locator(".p-select-overlay .p-select-filter");
    await filterInput.fill("Claude");

    // Should show Claude Sonnet but not GPT options
    const visibleOptions = page.locator(".p-select-overlay .p-select-option:visible");
    await expect(visibleOptions).toHaveCount(1);
    await expect(visibleOptions.first()).toContainText("Claude Sonnet");
  });
});

// ─── MP-5: allowed_engines filter shows only permitted engine models ────────

test.describe("MP-5: allowed_engines filter restricts visible models", () => {
  test("only claude models appear when allowed_engines is ['claude']", async ({ page, api }) => {
    const session = makeChatSession({
      id: 2005,
      conversationId: 6005,
      title: "Filtered engines session",
      model: null,
      workspaceKey: WORKSPACE_KEY,
    });

    // Only claude models (simulating allowed_engines = ["claude"] filter on backend)
    const claudeOnlyModels = [
      { id: "claude/claude-sonnet-4-5", displayName: "Claude Sonnet", contextWindow: 200_000, engineId: "claude" },
    ];
    api.returns("models.listEnabled", claudeOnlyModels);
    api.returns("chatSessions.list", [session]);
    api.handle("chatSessions.get", () => session);
    api.handle("chatSessions.getMessages", () => ({ messages: [], hasMore: false }));

    await page.goto("/");
    await openSessionDrawer(page, session.id);

    await page.locator(".session-chat-view .input-model-select").click();
    await expect(page.locator(".p-select-overlay")).toBeVisible({ timeout: 2_000 });

    const options = page.locator(".p-select-overlay .p-select-option");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Claude Sonnet");

    // No copilot group header
    const groupHeaders = page.locator(".p-select-overlay .model-select__group-header");
    await expect(groupHeaders).toHaveCount(0);
  });
});
