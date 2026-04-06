/**
 * bridge.ts — HTTP transport to the Electrobun debug server on localhost:9229.
 *
 * The debug server exposes these endpoints:
 *   GET  /inspect?script=...          — evaluate JS in WKWebView (≤ 1000 chars)
 *   POST /inspect                     — evaluate JS in WKWebView (body = script, unlimited length)
 *   GET  /click?selector=...          — dispatch mousedown + mouseup + click on a DOM element
 *   GET  /screenshot?path=...         — capture screen via screencapture (returns {path})
 *   GET  /reset-decisions?taskId=N    — delete all hunk decisions for task N from the DB (test setup helper)
 *
 * All scripts must use explicit `return` statements (not bare expressions) and may
 * use `new Promise(...)` for async operations since evaluateJavascriptWithResponse
 * supports both sync and Promise-returning scripts.
 *
 * Double-JSON encoding: the server wraps the JS return value in JSON.stringify, then
 * the Electrobun RPC layer wraps it again. We parse twice to get the real value.
 */

export const BRIDGE_BASE = "http://localhost:9229";

// ─── Core transport ───────────────────────────────────────────────────────────

/**
 * Evaluate a JavaScript expression inside the WKWebView.
 * The script must use `return` to produce a value. Return complex values as
 * `JSON.stringify(...)` — the bridge automatically handles the double-encode.
 */
export async function webEval<T = unknown>(script: string): Promise<T> {
  const res =
    script.length > 1_000
      ? await fetch(BRIDGE_BASE + "/inspect", {
          method: "POST",
          body: script,
          headers: { "content-type": "text/plain" },
        })
      : await fetch(`${BRIDGE_BASE}/inspect?script=${encodeURIComponent(script)}`);

  if (!res.ok) throw new Error(`Bridge server ${res.status}: ${await res.text()}`);

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  // The server wraps the WebView return value in JSON.stringify; the RPC layer
  // wraps it once more. One JSON.parse gives us the inner JSON string — parse again.
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      /* leave as string */
    }
  }

  // The server wraps all scripts in try/catch and returns {__error} on JS exceptions.
  if (
    parsed &&
    typeof parsed === "object" &&
    "__error" in (parsed as Record<string, unknown>)
  ) {
    throw new Error(`WebView JS error: ${(parsed as { __error: string }).__error}`);
  }

  return parsed as T;
}

/**
 * Simulate a user click on the first element matching `selector`.
 * Dispatches mousedown → mouseup → click in the WKWebView.
 */
export async function webClick(selector: string): Promise<string> {
  const res = await fetch(
    `${BRIDGE_BASE}/click?selector=${encodeURIComponent(selector)}`,
  );
  return res.text();
}

/**
 * Capture a screenshot of the app window via `screencapture`.
 * @param label Used to construct the file name: /tmp/railyn-test-<label>-<ts>.png
 * Returns the saved path, or null on failure.
 */
export async function screenshot(label: string): Promise<string | null> {
  const path = `/tmp/railyn-test-${label}-${Date.now()}.png`;
  try {
    const res = await fetch(`${BRIDGE_BASE}/screenshot?path=${encodeURIComponent(path)}`);
    const data = await res.json() as { path?: string; __error?: string };
    if (data.__error) {
      console.warn(`  📷 screenshot failed: ${data.__error}`);
      return null;
    }
    console.log(`  📷 screenshot → ${data.path}`);
    return data.path ?? null;
  } catch (e) {
    console.warn(`  📷 screenshot error: ${e}`);
    return null;
  }
}

/**
 * Delete all persisted hunk decisions for `taskId` from the database.
 * Use this at the start of test suites that need a clean review state.
 */
export async function resetDecisions(taskId: number): Promise<void> {
  const res = await fetch(`${BRIDGE_BASE}/reset-decisions?taskId=${taskId}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`resetDecisions failed: ${body}`);
  }
}

/**
 * Set up a self-contained test environment with a fresh git worktree and
 * known test files. Returns the taskId and file list so tests are not
 * coupled to any pre-existing app data.
 *
 * The worktree is a temporary git repo with 3 new untracked files. Each
 * represents one pending hunk, giving tests a predictable isolated baseline.
 */
export async function setupTestEnv(): Promise<{ taskId: number; files: string[] }> {
  const res = await fetch(`${BRIDGE_BASE}/setup-test-env`);
  const data = await res.json() as { taskId?: number; files?: string[]; __error?: string };
  if (data.__error) throw new Error(`setupTestEnv failed: ${data.__error}`);
  if (!data.taskId || !data.files) throw new Error("setupTestEnv: unexpected response");
  return { taskId: data.taskId, files: data.files };
}

// ─── Timing ───────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Waiters ──────────────────────────────────────────────────────────────────

/**
 * Poll until at least one element matching `selector` exists in the DOM.
 * Returns true when found, false on timeout.
 */
export async function waitFor(
  selector: string,
  timeoutMs = 6_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await webEval<number>(
      `return document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
    if (Number(n) > 0) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Poll until at least one `.hunk-bar` zone container has a non-zero CSS height.
 * Monaco sets the zone container height via inline style after layoutZone() fires.
 */
export async function waitForZones(timeoutMs = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await webEval<boolean>(`
      return !!Array.from(document.querySelectorAll('.hunk-bar')).find(function(b) {
        return b.parentElement && parseInt(b.parentElement.style.height) > 0;
      });
    `);
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

// ─── Pinia helpers ────────────────────────────────────────────────────────────

/** Read the currently selected file from the review Pinia store. */
export function reviewSelectedFile(): Promise<string> {
  return webEval<string>(
    `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').selectedFile`,
  );
}

/**
 * Open the code review overlay in "review" mode.
 *
 * When `opts` is provided (taskId + files), the overlay is opened directly via
 * the Pinia store — no badge click required. This path works for any task,
 * including dynamically-created test tasks.
 *
 * When called without arguments it falls back to the badge-click path for
 * whatever task is already visible on the board (legacy / manual-testing use).
 *
 * Steps:
 *  1. Close any already-open overlay.
 *  2a. (opts path) Call reviewStore.openReview(taskId, files) via Pinia directly.
 *  2b. (badge path) Refresh badge count, click .task-card__changed-badge.
 *  3. Wait for .review-overlay to appear.
 *  4. Assert mode === "review" (required for action bars + nav buttons to render).
 */
export async function openReviewOverlay(opts?: { taskId: number; files: string[] }): Promise<void> {
  // Close any already-open overlay
  await webEval(`
    var pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.['$pinia'];
    var r = pinia?._s.get('review');
    if (r?.isOpen) r.closeReview();
    return 'ok';
  `);
  await sleep(400);

  if (opts) {
    // Direct Pinia path — works for any task without needing a task card in the UI.
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').openReview(${opts.taskId}, ${JSON.stringify(opts.files)});
      return 'ok';
    `);
  } else {
    // Badge-click path — requires task 1 to be visible as a card in BoardView.
    await webEval(`
      return new Promise(async function(resolve) {
        var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
        await pinia._s.get('task').refreshChangedFiles(1);
        resolve('ok');
      });
    `);
    await sleep(400);
    await webClick(".task-card__changed-badge");
  }

  const opened = await waitFor(".review-overlay", 8_000);
  if (!opened) throw new Error("Review overlay did not open");
  await sleep(1_000);

  // openReview() sets mode = "review" automatically.
  // Verify this — action bars and nav buttons only render in review mode.
  const mode = await webEval<string>(
    `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').mode`,
  );
  if (mode !== "review") {
    throw new Error(`Expected overlay mode "review" after openReview(), got "${mode}"`);
  }
}

/**
 * Select the content-rich test file (prefers SetupView.vue > BoardView.vue > any .vue)
 * and wait for the Monaco diff to load.
 */
export async function selectRichTestFile(): Promise<string> {
  const file = await webEval<string>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var r = pinia._s.get('review');
    var files = r.files;
    var best = files.find(function(f) { return f.includes('SetupView'); })
      || files.find(function(f) { return f.includes('BoardView'); })
      || files.find(function(f) { return f.endsWith('.vue'); })
      || files[0];
    r.selectedFile = best;
    return best;
  `);
  await sleep(1_200);
  return file;
}

/**
 * Select the tracked partial-change test file from the review.
 * Prefers partial-x.ts (committed base + two disjoint hunks modified in the worktree).
 * Falls back to any .ts file, then the first file.
 *
 * Use this in suites that specifically need to test multi-hunk partial diffs
 * (as opposed to new/untracked single-hunk files).
 */
export async function selectPartialTestFile(): Promise<string> {
  const file = await webEval<string>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var r = pinia._s.get('review');
    var files = r.files;
    var best = files.find(function(f) { return f.includes('partial-x'); })
      || files.find(function(f) { return f.endsWith('.ts') && !f.includes('feature'); })
      || files.find(function(f) { return f.endsWith('.ts'); })
      || files[0];
    r.selectedFile = best;
    return best;
  `);
  await sleep(1_200);
  return file;
}

/**
 * Navigate to the first pending hunk in the current file by pressing Prev until
 * the file changes (we backed out into the previous file), then pressing Next once
 * to arrive back at the first hunk of the original file.
 */
export async function navToFirstHunk(maxPresses = 20): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    const before = await reviewSelectedFile();
    await webClick(".nav-btn"); // ← Prev
    await sleep(450);
    const after = await reviewSelectedFile();
    if (after !== before) {
      // Backed into previous file — one Next brings us to the first hunk of the target file
      await webClick(".nav-btn:last-of-type"); // → Next
      await sleep(800);
      return;
    }
  }
  // Already on first hunk (never changed file within maxPresses presses)
}

// ─── Chat helpers ─────────────────────────────────────────────────────────────

/**
 * Open the TaskDetailDrawer for the given task.
 *
 * Uses the test HTTP bridge to preload tasks (avoids calling async RPC store
 * methods inside evaluateJavascriptWithResponse, which deadlocks Electrobun).
 * Then synchronously sets `activeTaskId` in Pinia and calls `loadMessages`
 * via a fire-and-forget webEval so the drawer renders.
 */
export async function openTaskDrawer(taskId: number): Promise<void> {
  // Step 1: trigger a tasks.list fetch via the bridge so the store is populated.
  // We do this with a fire-and-forget webEval (no await inside the eval).
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var taskStore = pinia._s.get('task');
    var boardStore = pinia._s.get('board');
    var boardId = boardStore.activeBoardId;
    if (boardId != null) taskStore.loadTasks(boardId); // fire-and-forget
    return 'ok';
  `);
  // Give loadTasks time to complete (it's async but we can't await it in webEval)
  await sleep(1_500);

  // Step 2: set activeTaskId and load messages — also fire-and-forget.
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var taskStore = pinia._s.get('task');
    taskStore.activeTaskId = ${taskId};
    taskStore.loadMessages(${taskId}); // fire-and-forget
    return 'ok';
  `);
  await sleep(800);

  const opened = await waitFor(".task-detail", 8_000);
  if (!opened) throw new Error(`Task drawer did not open for task ${taskId}`);
  await sleep(200);
}

/**
 * Close the TaskDetailDrawer by calling `taskStore.closeTask()` through Pinia.
 */
export async function closeTaskDrawer(): Promise<void> {
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    pinia._s.get('task').closeTask();
    return 'ok';
  `);
  await sleep(400);
}

/**
 * Send a chat message to the given task via the dedicated test HTTP endpoint
 * `/test-send-message`. This bypasses the RPC-over-webEval deadlock (Electrobun
 * cannot deliver bun→WebView IPC while evaluateJavascriptWithResponse is pending).
 *
 * Returns once the user message has been persisted and the async stream has
 * started. Tokens arrive via the normal IPC path. Call `waitForStreamingDone`
 * afterwards to wait for completion.
 */
export async function sendChatMessage(text: string, taskId?: number): Promise<void> {
  const id = taskId ?? await webEval<number>(
    `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('task').activeTaskId`,
  );
  if (!id) throw new Error("sendChatMessage: no active task");
  const res = await fetch(
    `${BRIDGE_BASE}/test-send-message?taskId=${id}&text=${encodeURIComponent(text)}`,
  );
  const data = await res.json() as { messageId?: number; executionId?: number; __error?: string };
  if (data.__error) throw new Error(`sendChatMessage failed: ${data.__error}`);
  await sleep(200);
}

/**
 * Wait until the live streaming bubble (`.msg__bubble.streaming`) is gone AND
 * the task's execution state is no longer `running`.
 * Returns true when settled, false on timeout.
 */
export async function waitForStreamingDone(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await webEval<{ streaming: boolean; running: boolean }>(`
      var streamingBubble = document.querySelector('.msg__bubble.streaming');
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      var store = pinia._s.get('task');
      var activeTask = store.activeTask;
      return JSON.stringify({
        streaming: !!streamingBubble,
        running: activeTask ? activeTask.executionState === 'running' : false
      });
    `);
    if (!result.streaming && !result.running) return true;
    await sleep(300);
  }
  return false;
}

/**
 * Returns the number of message bubbles of the given role in the conversation.
 * @param role  "user" → `.msg--user`, "assistant" → `.msg--assistant`
 */
export async function getMessageCount(role: "user" | "assistant"): Promise<number> {
  return webEval<number>(
    `return document.querySelectorAll('.msg--${role}').length`,
  );
}

/**
 * Returns the text content of all messages of the given role (in DOM order).
 */
export async function getMessageTexts(role: "user" | "assistant"): Promise<string[]> {
  return webEval<string[]>(`
    return JSON.stringify(
      Array.from(document.querySelectorAll('.msg--${role} .msg__bubble'))
        .map(function(el) { return el.textContent.trim(); })
    );
  `);
}

/**
 * Return the current `executionState` of the active task from Pinia.
 */
export async function getActiveTaskExecutionState(): Promise<string | null> {
  return webEval<string | null>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var task = pinia._s.get('task').activeTask;
    return task ? task.executionState : null;
  `);
}

/**
 * Poll until the active task's `executionState` equals `expected`.
 * Returns true when matched, false on timeout.
 */
export async function waitForExecutionState(expected: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await getActiveTaskExecutionState();
    if (state === expected) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Cancel the running execution for `taskId` via the test HTTP bridge.
 * The abort signal fires immediately; the DB state update (→ 'waiting_user')
 * is async — call `waitForExecutionState('waiting_user')` afterwards.
 */
export async function cancelExecution(taskId: number): Promise<void> {
  const res = await fetch(`${BRIDGE_BASE}/test-cancel?taskId=${taskId}`);
  const data = await res.json() as { ok?: boolean; __error?: string };
  if (data.__error) throw new Error(`cancelExecution failed: ${data.__error}`);
}

/**
 * Change the model for `taskId` via the test HTTP bridge.
 * Also pushes an updated Task via IPC so the Vue store reflects the change.
 */
export async function setTaskModel(taskId: number, model: string): Promise<void> {
  const res = await fetch(`${BRIDGE_BASE}/test-set-model?taskId=${taskId}&model=${encodeURIComponent(model)}`);
  const data = await res.json() as { taskId?: number; model?: string; __error?: string };
  if (data.__error) throw new Error(`setTaskModel failed: ${data.__error}`);
  await sleep(200); // let Vue re-render the model selector
}

/**
 * Return the model ID shown in the task drawer's model selector (from Pinia).
 */
export async function getActiveTaskModel(): Promise<string | null> {
  return webEval<string | null>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var task = pinia._s.get('task').activeTask;
    return task ? task.model : null;
  `);
}

/**
 * Trigger compaction for `taskId` via the test HTTP bridge.
 * The bun side calls compactConversation and pushes the resulting
 * compaction_summary message via IPC. The test should wait for the
 * message to appear before asserting.
 * Returns the messageId of the new compaction_summary.
 */
export async function compactTask(taskId: number): Promise<number> {
  const res = await fetch(`${BRIDGE_BASE}/test-compact?taskId=${taskId}`);
  const data = await res.json() as { ok?: boolean; messageId?: number; __error?: string };
  if (data.__error) throw new Error(`compactTask failed: ${data.__error}`);
  await sleep(300);
  return data.messageId!;
}

/**
 * Return the number of compaction dividers rendered in the conversation
 * (each one corresponds to a `compaction_summary` message).
 */
export async function getCompactionSummaryCount(): Promise<number> {
  return webEval<number>(`return document.querySelectorAll('.msg--compaction').length`);
}

/**
 * Return the label text of the model selector for the active task.
 * Uses the PrimeVue Select's span.p-select-label element.
 */
export async function getModelSelectorLabel(): Promise<string> {
  return webEval<string>(`
    var el = document.querySelector('.input-model-select .p-select-label');
    return el ? el.textContent.trim() : '';
  `);
}

/**
 * Return true if the Compact button is present and NOT disabled.
 */
export async function isCompactButtonEnabled(): Promise<boolean> {
  return webEval<boolean>(`
    var btns = Array.from(document.querySelectorAll('.task-detail__model-row button'));
    var compact = btns.find(function(b) { return b.textContent.trim() === 'Compact'; });
    if (!compact) return false;
    return !compact.disabled && !compact.hasAttribute('aria-disabled');
  `);
}

/**
 * Return true if the Compact button is present but disabled (e.g. while running).
 */
export async function isCompactButtonDisabled(): Promise<boolean> {
  return webEval<boolean>(`
    var btns = Array.from(document.querySelectorAll('.task-detail__model-row button'));
    var compact = btns.find(function(b) { return b.textContent.trim() === 'Compact'; });
    if (!compact) return true;
    return compact.disabled || compact.hasAttribute('aria-disabled');
  `);
}

/**
 * Return true if the context gauge element is visible (rendered in DOM).
 */
export async function isContextGaugeVisible(): Promise<boolean> {
  return webEval<boolean>(`return !!document.querySelector('.context-gauge')`);
}

/**
 * Return the context usage fraction (0–1) from the Pinia task store.
 * Returns null if no context usage data is loaded yet.
 */
export async function getContextUsageFraction(): Promise<number | null> {
  return webEval<number | null>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var usage = pinia._s.get('task').contextUsage;
    return usage ? usage.fraction : null;
  `);
}

// ─── Board helpers ────────────────────────────────────────────────────────────

/** Navigate the app to /board and wait for the board view to render. */
export async function navigateToBoardView(): Promise<void> {
  await webEval(`
    var app = document.querySelector('#app').__vue_app__;
    app.config.globalProperties['$router'].push('/board');
    return 'ok';
  `);
  const ready = await waitFor('.board-view', 6_000);
  if (!ready) throw new Error('Board view did not appear after navigation');
  await sleep(300);
}

/**
 * Fire-and-forget loadTasks for the active board so the Vue store is populated.
 * Waits 1.2s for the async fetch to complete.
 */
export async function reloadBoardTasks(): Promise<void> {
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var boardStore = pinia._s.get('board');
    var taskStore  = pinia._s.get('task');
    var boardId = boardStore.activeBoardId;
    if (boardId != null) taskStore.loadTasks(boardId);
    return 'ok';
  `);
  await sleep(1_200);
}

/** Poll until .board-columns is present. */
export async function waitForBoardReady(timeoutMs = 8_000): Promise<boolean> {
  return waitFor('.board-columns', timeoutMs);
}

/** Return all [data-column-id] attribute values in DOM order. */
export async function getBoardColumnIds(): Promise<string[]> {
  return webEval<string[]>(`
    return JSON.stringify(
      Array.from(document.querySelectorAll('[data-column-id]'))
        .map(function(el) { return el.getAttribute('data-column-id'); })
    );
  `);
}

/** Return all .board-column__name text contents in DOM order. */
export async function getColumnLabels(): Promise<string[]> {
  return webEval<string[]>(`
    return JSON.stringify(
      Array.from(document.querySelectorAll('.board-column__name'))
        .map(function(el) { return el.textContent.trim(); })
    );
  `);
}

/** True if the task card for taskId is inside the column with the given columnId. */
export async function isTaskInColumn(taskId: number, columnId: string): Promise<boolean> {
  return webEval<boolean>(`
    var card = document.querySelector('[data-task-id="' + ${taskId} + '"]');
    if (!card) return false;
    var col = card.closest('[data-column-id]');
    return col ? col.getAttribute('data-column-id') === ${JSON.stringify(columnId)} : false;
  `);
}

/** Return the classList array of the task card for taskId. */
export async function getTaskCardClasses(taskId: number): Promise<string[]> {
  return webEval<string[]>(`
    var card = document.querySelector('[data-task-id="' + ${taskId} + '"]');
    if (!card) return JSON.stringify([]);
    return JSON.stringify(Array.from(card.classList));
  `);
}

/** Return the text of the PrimeVue Tag (execution badge) inside a task card. */
export async function getTaskBadgeText(taskId: number): Promise<string> {
  return webEval<string>(`
    var card = document.querySelector('[data-task-id="' + ${taskId} + '"]');
    if (!card) return '';
    var tag = card.querySelector('.p-tag');
    return tag ? tag.textContent.trim() : '';
  `);
}

/**
 * Transition a task to a new workflow state via the /test-transition HTTP endpoint.
 * The backend updates the DB, pushes task.updated via IPC, and (if the target
 * column has on_enter_prompt) starts an async execution.
 */
export async function transitionTaskTo(taskId: number, toState: string): Promise<void> {
  const res = await fetch(
    `${BRIDGE_BASE}/test-transition?taskId=${taskId}&toState=${encodeURIComponent(toState)}`,
  );
  const data = await res.json() as { task?: unknown; executionId?: unknown; __error?: string };
  if (data.__error) throw new Error(`transitionTaskTo failed: ${data.__error}`);
  await sleep(300); // give IPC push time to reach Vue store
}

/**
 * Poll the DOM until the task card for taskId appears under columnId.
 * Returns true when found, false on timeout.
 */
export async function waitForTaskInColumn(
  taskId: number,
  columnId: string,
  timeoutMs = 6_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTaskInColumn(taskId, columnId)) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Poll the DOM until the task card for taskId has the given CSS class.
 * Returns true when found, false on timeout.
 */
export async function waitForTaskCardClass(
  taskId: number,
  className: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const classes = await getTaskCardClasses(taskId);
    if (classes.includes(className)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Read a task's executionState directly from the Pinia board/task store,
 * without needing the task drawer to be open.
 */
export async function getTaskExecutionStateFromStore(taskId: number): Promise<string | null> {
  return webEval<string | null>(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    var taskStore = pinia._s.get('task');
    var allTasks = Object.values(taskStore.tasksByBoard).flat();
    var task = allTasks.find(function(t) { return t.id === ${taskId}; });
    return task ? task.executionState : null;
  `);
}
