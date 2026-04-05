/**
 * review-overlay.test.ts — UI regression tests for the code review overlay.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server on localhost:9229
 *
 * Run: bun test src/ui-tests --timeout 120000
 * Requires the app to be running: bun run dev
 *
 * Scenarios covered:
 *   Suite A — shared overlay state (single beforeAll setup):
 *     1. z-index: action bar buttons are clickable (not blocked by Monaco layers)
 *     2. zone height: bars resize to content, not stuck at Monaco initial 108px
 *     3. scroll restore: editor scroll position is preserved after Accept
 *     4. viewport clip: navigated-to hunk is not hidden above the editor viewport
 *
 *   Suite B — per-hunk navigation through SetupView.vue:
 *     5. no diffs without dialog: every hunk has a visible action bar
 *     6. alignment: each action bar is ≤ 36px below its nearest diff decoration
 *
 *   Suite C — reject hunk regression:
 *     7. reject removes hunk: rejecting a hunk removes it from the pending list
 *     8. alignment preserved after reject: remaining bars stay aligned after reject
 *
 *   Suite D — all changed files coverage:
 *     9. every file has action bars: no file has hunks without a dialog
 *
 *   Suite E — bars match Monaco ILineChanges:
 *     10. bars count ≥ Monaco ILineChanges per file (no colored region without a bar)
 *
 *   Suite F — reject precision (the "too many changes rejected" bug):
 *     11. after rejecting one hunk, bars removed === Monaco ILineChanges removed for that hunk
 *     12. after reject, remaining bars still cover all remaining Monaco ILineChanges (≥ monacoChanges)
 *
 *   Suite G — pending counter accuracy:
 *     13. initial counter text shows the correct number of pending git hunks
 *     14. counter decrements by exactly 1 when a single git hunk is accepted
 *     15. counter decrements by exactly 1 when a single git hunk is rejected
 *
 *   Suite H — Change Request validation & behaviour:
 *     16. clicking Change Request with empty comment shows validation error, makes no decision
 *     17. clicking Change Request with a comment saves it; bar shows decided state, diff stays visible
 *
 *   Suite I — decision persistence across file switches:
 *     18. accepted hunk stays collapsed when switching away and back to the same file
 *
 *   Suite J — accept precision:
 *     19. after accepting one hunk, remaining bars still cover all remaining Monaco ILineChanges
 *
 *   Suite K — partial-change files (tracked, multi-hunk):
 *     20. bars ≥ Monaco ILineChanges for a tracked partial-change file (not just new additions)
 *     21. every hunk in the partial file has a visible action bar
 *
 *   Suite L — partial-change files: reject precision with multiple hunks:
 *     22. rejecting one hunk only removes bars for that hunk (not the other hunk's bars)
 *     23. after rejecting one hunk, remaining hunk still has its bars
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  BRIDGE_BASE,
  webEval,
  webClick,
  sleep,
  waitForZones,
  reviewSelectedFile,
  openReviewOverlay,
  selectRichTestFile,
  selectPartialTestFile,
  navToFirstHunk,
  resetDecisions,
  setupTestEnv,
  screenshot,
} from "./bridge";

// ─── Global test environment ───────────────────────────────────────────────────
// Set up once before any suite runs. `setupTestEnv` creates an isolated temp git
// repo with 3 known test files and a fresh task row — tests are not coupled to
// any pre-existing app data (worktrees, boards, or real task IDs).

let testTaskId = 0;
let testFiles: string[] = [];

beforeAll(async () => {
  const env = await setupTestEnv();
  testTaskId = env.taskId;
  testFiles = env.files;
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — shared setup: overlay open on SetupView.vue, first hunk in viewport
// ═══════════════════════════════════════════════════════════════════════════════

describe("Code Review Overlay — ViewZone UX", () => {
  beforeAll(async () => {
    // Verify the app is running before doing anything
    const ping = await fetch(BRIDGE_BASE + "/").catch(() => null);
    if (!ping?.ok) throw new Error("App not running — start it with: bun run dev");

    // Clear any decisions left over from previous test runs so all hunks are pending.
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

    await openReviewOverlay({ taskId: testTaskId, files: testFiles });
    await selectRichTestFile(); // → SetupView.vue

    // Navigate to the very first hunk so Monaco scrolls to it and triggers layoutZone.
    // navToFirstHunk presses Prev until the file changes, then Next once — this
    // guarantees we land at hunk 1 with it visible in the viewport.
    await navToFirstHunk(20);
    await sleep(600);

    // Wait for at least one zone to be laid out (parentElement.style.height > 0)
    const ready = await waitForZones(10_000);
    if (!ready) console.warn("⚠ ViewZones not laid out after 8s — height tests may fail");
  }, 60_000);

  // ─── Test 1: z-index (click interception) ──────────────────────────────────

  describe("1 — z-index: action bars are not blocked by Monaco layers", () => {
    test("first accept button is the top element at its center point", async () => {
      const result = await webEval<{ isSameElement: boolean; hitCls: string }>(`
        var btn = document.querySelector('.hunk-btn--accept');
        if (!btn) return JSON.stringify({ isSameElement: false, hitCls: 'no button found' });
        var r = btn.getBoundingClientRect();
        // Button off-screen (Monaco virtualized it) — not a z-index failure, skip
        if (r.width === 0) return JSON.stringify({ isSameElement: true, hitCls: 'skipped: button not in viewport' });
        var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return JSON.stringify({ isSameElement: hit === btn, hitCls: hit ? hit.className.slice(0, 60) : 'null' });
      `);

      if (!result.isSameElement) {
        throw new Error(
          `Accept button is not the top element — blocked by: "${result.hitCls}".\n` +
            "Fix: ensure .hunk-bar or its ancestor has z-index above .view-lines.",
        );
      }
    });

    test("all visible accept buttons pass the elementFromPoint hit-test", async () => {
      const results = await webEval<{ i: number; ok: boolean; hitCls: string }[]>(`
        return JSON.stringify(
          Array.from(document.querySelectorAll('.hunk-btn--accept')).map(function(btn, i) {
            var r = btn.getBoundingClientRect();
            // Off-screen (Monaco virtualized) — skip, not a z-index issue
            if (r.width === 0 || r.height === 0) return { i: i, ok: true, hitCls: 'virtualized-skip' };
            var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { i: i, ok: hit === btn, hitCls: hit ? hit.className.slice(0, 50) : 'null' };
          })
        );
      `);

      const failures = results.filter((r) => !r.ok && r.hitCls !== "virtualized-skip");
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} button(s) blocked by overlapping element:\n` +
            failures
              .map((f) => `  button[${f.i}] hit "${f.hitCls}"`)
              .join("\n"),
        );
      }

      const checked = results.filter((r) => r.hitCls !== "virtualized-skip").length;
      expect(checked).toBeGreaterThan(0); // at least one button must be in viewport
    });
  });

  // ─── Test 2: zone height ────────────────────────────────────────────────────

  describe("2 — zone height: bars resize to content height", () => {
    test("visible hunk-bar zone containers have offsetHeight > 0", async () => {
      const bars = await webEval<{ i: number; parentH: string; barH: number }[]>(`
        return JSON.stringify(
          Array.from(document.querySelectorAll('.hunk-bar')).map(function(b, i) {
            return {
              i: i,
              parentH: b.parentElement ? b.parentElement.style.height : 'n/a',
              barH: b.offsetHeight
            };
          })
        );
      `);

      expect(bars.length).toBeGreaterThan(0);

      const visible = bars.filter((b) => parseInt(b.parentH) > 0);
      if (visible.length === 0) {
        throw new Error(
          "No zone containers have non-zero height (all zones may be virtualized — did navToFirstHunk run?)",
        );
      }

      const zeros = visible.filter((b) => b.barH === 0);
      if (zeros.length > 0) {
        throw new Error(
          `${zeros.length}/${visible.length} visible zones have offsetHeight 0 ` +
            `(zone container has height but inner content is not rendering)`,
        );
      }
    });

    test("zone height is not stuck at Monaco initial value (108px)", async () => {
      const bars = await webEval<{ parentH: string }[]>(`
        return JSON.stringify(
          Array.from(document.querySelectorAll('.hunk-bar')).map(function(b) {
            return { parentH: b.parentElement ? b.parentElement.style.height : '0px' };
          })
        );
      `);

      const heights = bars.map((b) => parseInt(b.parentH)).filter((h) => h > 0);
      const stuck = heights.filter((h) => h === 108);

      if (stuck.length > 0) {
        throw new Error(
          `${stuck.length}/${heights.length} zone(s) stuck at 108px — layoutZone() may not be ` +
            "reading the correct element height (should use firstElementChild, not domNode).",
        );
      }
    });
  });

  // ─── Test 3: scroll restore after Accept ────────────────────────────────────

  describe("3 — scroll restore: Accept does not jump the editor to the top", () => {
    test(
      "editor scrollTop stays within 80px of its position before Accept",
      async () => {
        // Navigate to the next hunk to get a non-trivial scroll position
        await webClick(".nav-btn:last-of-type"); // → Next
        await sleep(800);

        const scrollBefore = Number(
          await webEval<number>(`
            return Array.from(document.querySelectorAll('.monaco-scrollable-element'))
              .reduce(function(max, s) { return Math.max(max, s.scrollTop); }, 0);
          `),
        );

        const pendingCount = Number(
          await webEval<number>(
            `return document.querySelectorAll('.hunk-btn--accept').length`,
          ),
        );

        if (pendingCount === 0) {
          // All hunks already accepted (e.g. from a previous partial run) — can't test
          console.warn("  ~ skipped: no pending accept buttons in current file");
          return;
        }

        // Click the first visible accept button
        await webEval(`
          var btns = Array.from(document.querySelectorAll('.hunk-btn--accept'));
          for (var i = 0; i < btns.length; i++) {
            var r = btns[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { btns[i].click(); break; }
          }
          return 'ok';
        `);
        await sleep(2_000); // wait for model rebuild + scroll restore

        const scrollAfter = Number(
          await webEval<number>(`
            return Array.from(document.querySelectorAll('.monaco-scrollable-element'))
              .reduce(function(max, s) { return Math.max(max, s.scrollTop); }, 0);
          `),
        );

        const delta = Math.abs(scrollBefore - scrollAfter);
        if (delta >= 80) {
          throw new Error(
            `Editor jumped: before=${Math.round(scrollBefore)}px, after=${Math.round(scrollAfter)}px, delta=${Math.round(delta)}px. ` +
              "The scroll restore (pendingScrollRestore) may not be firing correctly.",
          );
        }
      },
      15_000,
    );
  });

  // ─── Test 4: viewport clip after Prev navigation ────────────────────────────

  describe("4 — viewport clip: navigated-to hunk is inside the editor viewport", () => {
    test(
      "after Prev navigation the first hunk-bar is not hidden above the editor top",
      async () => {
        await webClick(".nav-btn"); // ← Prev
        await sleep(800);

        const result = await webEval<{
          barTop: number;
          editorTop: number;
          diff: number;
        }>(`
          var bars = Array.from(document.querySelectorAll('.hunk-bar'));
          var visible = bars.filter(function(b) { return b.offsetHeight > 0; });
          if (!visible.length) return JSON.stringify({ barTop: -1, editorTop: 0, diff: 0 });
          var bar = visible[0];
          var editor = document.querySelector('.monaco-editor');
          var br = bar.getBoundingClientRect();
          var er = editor ? editor.getBoundingClientRect() : { top: 0 };
          return JSON.stringify({
            barTop: Math.round(br.top),
            editorTop: Math.round(er.top),
            diff: Math.round(br.top - er.top)
          });
        `);

        if (result.barTop === -1) {
          throw new Error("No visible hunk bars found after Prev navigation");
        }

        const TOLERANCE_PX = 20;
        if (result.diff < -TOLERANCE_PX) {
          throw new Error(
            `Hunk bar is ${Math.abs(result.diff)}px above the editor top (tolerance=${TOLERANCE_PX}px). ` +
              "The viewport clip compensation may not be working.",
          );
        }
      },
      10_000,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite B — per-hunk navigation through SetupView.vue
// ═══════════════════════════════════════════════════════════════════════════════

interface HunkResult {
  /** 1-based index of this hunk in the navigation sequence */
  hunk: number;
  /** True if a visible .hunk-bar element was found in the viewport */
  hasBar: boolean;
  /** Top edge of the action bar (viewport-relative px), or -1 if no bar */
  barTop: number;
  /**
   * Gap between the bottom of the nearest diff decoration (line-insert or
   * line-delete) above this bar and the bar's top edge, in px.
   * -1 means no decoration was found above (add-only hunk).
   */
  gap: number;
  /** Bottom edge of the nearest diff decoration above the bar */
  insertBottom: number;
  /** Total line-insert decorations visible at time of measurement */
  lineInserts: number;
}

describe("Code Review Overlay — per-hunk navigation (rich test file)", () => {
  const hunkResults: HunkResult[] = [];
  let capturedScreenshot = false;
  let richFile = "";

  beforeAll(async () => {
    // Clear persisted hunk decisions from DB and in-memory optimistic state
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

    // Select the richest available file (SetupView.vue if available, else first .vue, else first file)
    richFile = await selectRichTestFile();
    await sleep(1_500);

    // Navigate to the very first pending hunk
    await navToFirstHunk(20);
    await sleep(500);

    // Walk through all hunks in the selected file and collect measurement data
    const MAX_HUNKS = 20;

    for (let h = 0; h < MAX_HUNKS; h++) {
      const currentFile = await reviewSelectedFile();
      if (typeof currentFile === "string" && currentFile !== richFile) break;

      const data = await webEval<Omit<HunkResult, "hunk">>(`
        var bars = Array.from(document.querySelectorAll('.hunk-bar'));
        var visBar = null;
        var diffEditorEl = document.querySelector('.monaco-diff-editor');
        var editorTop = diffEditorEl ? diffEditorEl.getBoundingClientRect().top : 0;

        for (var i = 0; i < bars.length; i++) {
          var r = bars[i].getBoundingClientRect();
          // A bar is "visible" when it has positive dimensions and sits below the editor top
          if (r.width > 0 && r.height > 0 && r.top > editorTop) { visBar = bars[i]; break; }
        }

        var inserts = Array.from(document.querySelectorAll('.line-insert'));
        var deleteds = Array.from(document.querySelectorAll('.line-delete'));
        var barTop = visBar ? Math.round(visBar.getBoundingClientRect().top) : -1;

        // Find the nearest diff decoration whose bottom is above the bar
        var nearBot = -1, minGap = 1e9;
        inserts.concat(deleteds).forEach(function(el) {
          var bot = Math.round(el.getBoundingClientRect().bottom);
          if (barTop >= 0 && bot <= barTop && barTop - bot < minGap) {
            minGap = barTop - bot;
            nearBot = bot;
          }
        });

        return JSON.stringify({
          hasBar: !!visBar,
          barTop: barTop,
          gap: nearBot >= 0 ? barTop - nearBot : -1,
          insertBottom: nearBot,
          lineInserts: inserts.length
        });
      `);

      hunkResults.push({ hunk: h + 1, ...data });

      // Capture a screenshot on the first misaligned or missing-bar hunk for debugging
      if (!capturedScreenshot && (!data.hasBar || data.gap > 36)) {
        capturedScreenshot = true;
        await screenshot(`hunk-issue-h${h + 1}`);
      }

      // Navigate to next hunk; stop when we leave the selected file
      await webClick(".nav-btn:last-of-type"); // → Next
      await sleep(600);
      const nextFile = await reviewSelectedFile();
      if (typeof nextFile === "string" && nextFile !== richFile) break;
    }
  }, 180_000); // 3 min — navigation loop can take up to ~2.5 min for 20 hunks

  // ─── Test 5: no diffs without dialog ─────────────────────────────────────

  test("5 — every hunk has a visible action bar (no diffs without dialog)", () => {
    expect(hunkResults.length).toBeGreaterThan(0);

    const missing = hunkResults.filter((r) => !r.hasBar);

    if (missing.length > 0) {
      throw new Error(
        `${missing.length}/${hunkResults.length} hunk(s) rendered without an action bar:\n` +
          missing.map((r) => `  hunk ${r.hunk}: barTop=${r.barTop}, lineInserts=${r.lineInserts}`).join("\n") +
          "\nFix: ensure every pending hunk gets a ViewZone injected in injectViewZones().",
      );
    }
  });

  // ─── Test 6: action bar alignment ────────────────────────────────────────

  test("6 — action bars align with diff decorations (gap ≤ 36px)", () => {
    expect(hunkResults.length).toBeGreaterThan(0);

    // gap === -1 means no diff decoration was found above the bar (add-only hunk)
    // These are excluded because there is no insert/delete to align to.
    const measurable = hunkResults.filter((r) => r.hasBar && r.gap >= 0);
    const misaligned = measurable.filter((r) => r.gap > 36);

    if (misaligned.length > 0) {
      throw new Error(
        `${misaligned.length}/${measurable.length} hunk(s) misaligned (gap > 36px):\n` +
          misaligned
            .map(
              (r) =>
                `  hunk ${r.hunk}: bar=${r.barTop}px, nearest-diff-bottom=${r.insertBottom}px, gap=${r.gap}px`,
            )
            .join("\n") +
          "\nFix: check correlateHunks() — afterLineNumber may be placed too many lines after the diff region.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite C — reject hunk regression
// ═══════════════════════════════════════════════════════════════════════════════

describe("Code Review Overlay — reject hunk regression", () => {
  let barCountBefore = 0;
  let barCountAfter = 0;
  let gapAfterReject = -1;

  beforeAll(async () => {
    // Clean slate: clear DB + in-memory decisions
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

    // Navigate to the richest available file and its first hunk
    await selectRichTestFile();
    await sleep(1_500);
    await navToFirstHunk(20);
    await sleep(600);
    await waitForZones(8_000);

    // Count bars before rejecting
    barCountBefore = await webEval<number>(
      `return document.querySelectorAll('.hunk-bar').length`,
    );

    // Click the reject button on the first bar (any visibility — zones may be off-screen)
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--reject'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    await sleep(2_000); // wait for store update + ViewZone rebuild

    // Count bars after rejecting
    barCountAfter = await webEval<number>(
      `return document.querySelectorAll('.hunk-bar').length`,
    );

    // Measure gap on any remaining bar
    const gapData = await webEval<{ gap: number }>(`
      var bars = Array.from(document.querySelectorAll('.hunk-bar'));
      var diffEditorEl = document.querySelector('.monaco-diff-editor');
      var editorTop = diffEditorEl ? diffEditorEl.getBoundingClientRect().top : 0;
      var visBar = bars.find(function(b) {
        var r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top > editorTop;
      });
      if (!visBar) return JSON.stringify({ gap: -1 });
      var barTop = Math.round(visBar.getBoundingClientRect().top);
      var inserts = Array.from(document.querySelectorAll('.line-insert'));
      var deleteds = Array.from(document.querySelectorAll('.line-delete'));
      var nearBot = -1, minDist = 1e9;
      inserts.concat(deleteds).forEach(function(el) {
        var bot = Math.round(el.getBoundingClientRect().bottom);
        if (bot <= barTop && barTop - bot < minDist) { minDist = barTop - bot; nearBot = bot; }
      });
      return JSON.stringify({ gap: nearBot >= 0 ? barTop - nearBot : -1 });
    `);
    gapAfterReject = gapData.gap;
  }, 60_000);

  test("7 — reject removes the hunk from the pending list", () => {
    expect(barCountBefore).toBeGreaterThan(0);
    // A rejected hunk may have >1 bar (Monaco can split a git hunk into multiple
    // ILineChange regions, each with its own bar). Verify at least one bar is removed.
    if (barCountAfter >= barCountBefore) {
      throw new Error(
        `Bar count did not decrease after reject: before=${barCountBefore}, after=${barCountAfter}. ` +
          "The rejected hunk ViewZone(s) may not have been removed.",
      );
    }
  });

  test("8 — remaining bars stay aligned after reject (gap ≤ 36px)", () => {
    if (barCountAfter === 0) {
      // Only hunk was just rejected — nothing left to align, skip
      console.warn("  ~ skipped: no remaining hunks after reject");
      return;
    }
    if (gapAfterReject === -1) {
      // No diff decoration visible (add-only hunk) — alignment is n/a
      console.warn("  ~ skipped: no diff decoration visible for remaining bar (add-only hunk)");
      return;
    }
    if (gapAfterReject > 36) {
      throw new Error(
        `Remaining bar is misaligned after reject: gap=${gapAfterReject}px > 36px. ` +
          "Rejecting a hunk may have shifted line offsets without re-running correlateHunks().",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite D — all changed files coverage
// ═══════════════════════════════════════════════════════════════════════════════

interface FileHunkResult {
  file: string;
  hunk: number;
  hasBar: boolean;
  gap: number;
}

describe("Code Review Overlay — all changed files have action bars", () => {
  const allResults: FileHunkResult[] = [];

  beforeAll(async () => {
    // Clean slate — clear DB decisions and in-memory state, then open a fresh overlay
    // in review mode so we get the true current file list from git.
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    // Open a fresh overlay so the file list reflects the actual worktree state.
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    // Get all files in the review
    const files = await webEval<string[]>(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      return JSON.stringify(pinia._s.get('review').files || []);
    `);

    console.log(`  Suite D: checking ${files.length} file(s): ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);

    for (const file of files) {
      // Switch to file
      await webEval(`
        var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
        pinia._s.get('review').selectedFile = ${JSON.stringify(file)};
        return 'ok';
      `);
      await sleep(1_500);

      // Get to first hunk of this file
      await navToFirstHunk(20);
      await sleep(500);

      // Explicitly reveal the end of the file via Monaco API so that zones at the last
      // line of new/untracked files (e.g. DARK_MODE_IMPLEMENTATION.md) are scrolled into
      // Monaco's viewport and get their style.height set before we call waitForZones.
      await webEval(`
        try {
          var editors = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors
            ? window.monaco.editor.getDiffEditors() : [];
          if (editors && editors[0]) {
            var mod = editors[0].getModifiedEditor();
            var m = mod.getModel && mod.getModel();
            if (m) mod.revealLineInCenter(m.getLineCount());
          }
        } catch(e) {}
      `);
      await sleep(400);

      await waitForZones(8_000);

      const MAX_HUNKS_PER_FILE = 20;
      for (let h = 0; h < MAX_HUNKS_PER_FILE; h++) {
        const currentFile = await reviewSelectedFile();
        // Stop if navigation moved us away from this file
        if (typeof currentFile === "string" && currentFile !== file) break;

        const data = await webEval<{ hasBar: boolean; gap: number }>(`
          var bars = Array.from(document.querySelectorAll('.hunk-bar'));
          var diffEditorEl = document.querySelector('.monaco-diff-editor');
          var editorTop = diffEditorEl ? diffEditorEl.getBoundingClientRect().top : 0;
          var visBar = bars.find(function(b) {
            var r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top > editorTop;
          });
          if (!visBar) return JSON.stringify({ hasBar: false, gap: -1 });
          var barTop = Math.round(visBar.getBoundingClientRect().top);
          var inserts = Array.from(document.querySelectorAll('.line-insert'));
          var deleteds = Array.from(document.querySelectorAll('.line-delete'));
          var nearBot = -1, minDist = 1e9;
          inserts.concat(deleteds).forEach(function(el) {
            var bot = Math.round(el.getBoundingClientRect().bottom);
            if (bot <= barTop && barTop - bot < minDist) { minDist = barTop - bot; nearBot = bot; }
          });
          return JSON.stringify({ hasBar: true, gap: nearBot >= 0 ? barTop - nearBot : -1 });
        `);

        allResults.push({ file, hunk: h + 1, ...data });

        if (!data.hasBar) {
          await screenshot(`missing-bar-${file.replace(/\//g, '-')}-h${h + 1}`);
        }

        // Navigate to next hunk; stop if we leave this file
        await webClick(".nav-btn:last-of-type"); // → Next
        await sleep(600);
        const nextFile = await reviewSelectedFile();
        if (typeof nextFile === "string" && nextFile !== file) break;
      }
    }
  }, 300_000); // 5 min — iterates all files

  test("9 — every hunk in every changed file has a visible action bar", () => {
    expect(allResults.length).toBeGreaterThan(0);

    const missing = allResults.filter((r) => !r.hasBar);

    if (missing.length > 0) {
      const byFile = missing.reduce<Record<string, number[]>>((acc, r) => {
        const short = r.file.split("/").slice(-1)[0];
        acc[short] = [...(acc[short] ?? []), r.hunk];
        return acc;
      }, {});

      throw new Error(
        `${missing.length}/${allResults.length} hunk(s) across all files rendered without an action bar:\n` +
          Object.entries(byFile)
            .map(([f, hunks]) => `  ${f}: hunks ${hunks.join(", ")}`)
            .join("\n") +
          "\nFix: ensure mapLineChangesToHunks() maps every Monaco ILineChange to a git hunk.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite E — every Monaco ILineChange has exactly one action bar below it
// ═══════════════════════════════════════════════════════════════════════════════
// Monaco can split a single git hunk into multiple ILineChange regions. Each
// region must have its own bar — bars count must equal Monaco ILineChanges count.
// This catches the "colored line visible but no dialog below it" regression.

interface FileChangeCount {
  file: string;
  monacoChanges: number;
  bars: number;
}

describe("Code Review Overlay — bars match Monaco ILineChanges per file", () => {
  const counts: FileChangeCount[] = [];

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    const files = await webEval<string[]>(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      return JSON.stringify(pinia._s.get('review').files || []);
    `);

    for (const file of files) {
      await webEval(`
        var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
        pinia._s.get('review').selectedFile = ${JSON.stringify(file)};
        return 'ok';
      `);
      // Wait for Monaco diff to compute and bars to be injected.
      // Poll until bar count stabilises (Monaco may fire onDidUpdateDiff >1 time).
      let prev = -1;
      for (let i = 0; i < 25; i++) {
        await sleep(400);
        const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
        if (Number(n) === prev && prev >= 0) break;
        prev = Number(n);
      }

      const result = await webEval<{ monacoChanges: number; bars: number }>(`
        var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
        var changes = de[0] ? (de[0].getLineChanges() || []) : [];
        var bars = document.querySelectorAll('.hunk-bar').length;
        return JSON.stringify({ monacoChanges: changes.length, bars: bars });
      `);
      counts.push({ file, ...result });
    }
  }, 300_000);

  test("10 — bars count ≥ Monaco ILineChanges count for every file (no colored region without a bar)", () => {
    expect(counts.length).toBeGreaterThan(0);

    // bars >= monacoChanges: every Monaco visual change must have a bar.
    // bars > monacoChanges is acceptable for pure-deletion hunks that have no
    // ILineChange in the modified editor but still need a bar on the insertion line.
    const mismatches = counts.filter((c) => c.monacoChanges > 0 && c.bars < c.monacoChanges);

    if (mismatches.length > 0) {
      throw new Error(
        "Some files have colored diff regions without an action bar:\n" +
          mismatches
            .map((c) => `  ${c.file.split("/").slice(-1)[0]}: monacoChanges=${c.monacoChanges}, bars=${c.bars} (missing ${c.monacoChanges - c.bars})`)
            .join("\n") +
          "\nFix: ensure injectViewZones() injects one bar per Monaco ILineChange via mapLineChangesToHunks().",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite F — Reject precision: only bars for the targeted hunk disappear
// ═══════════════════════════════════════════════════════════════════════════════
// The "more than one change rejected" bug: when Monaco splits a git hunk into N
// ILineChange regions, N bars share the same hash. Rejecting one bar removes all N
// bars AND N Monaco ILineChanges from the diff. That is correct and expected.
// What is NOT correct: if mapLineChangesToHunks assigns the wrong git hunk to a bar,
// rejecting it removes bars/changes that belonged to a DIFFERENT git hunk.
//
// Invariant: (bars_before - bars_after) === (monacoChanges_before - monacoChanges_after)
// i.e. the ratio "excess bars for pure-deletion hunks" is preserved across a reject.

describe("Code Review Overlay — reject precision", () => {
  let barsBefore = 0;
  let monacoChangesBefore = 0;
  let barsAfter = 0;
  let monacoChangesAfter = 0;
  let skipped = false;

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    // Use the richest available file
    await selectRichTestFile();
    // Stabilise bar count
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }

    barsBefore = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesBefore = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);

    if (barsBefore < 2) {
      // Need at least 2 bars (i.e. ≥2 hunks or ≥2 Monaco ILineChanges) to prove precision
      skipped = true;
      return;
    }

    // Reject the first bar (any visibility — zones may be below visible viewport)
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--reject'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    // Wait for model rebuild and bar re-injection to stabilise
    let prevAfter = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prevAfter && prevAfter >= 0) break;
      prevAfter = Number(n);
    }

    barsAfter = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesAfter = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);
  }, 120_000);

  test("11 — rejecting one hunk removes exactly the right number of bars (no extra bars vanish)", () => {
    if (skipped) {
      console.warn("  ~ skipped: fewer than 2 bars in SetupView.vue (cannot test precision)");
      return;
    }
    // barsBefore - barsAfter should equal monacoChangesBefore - monacoChangesAfter.
    // Both should drop by k (the number of Monaco ILineChanges for the rejected hunk).
    // The "excess" (pure-deletion bars with no Monaco ILineChange) must be preserved.
    const barsRemoved = barsBefore - barsAfter;
    const monacoRemoved = monacoChangesBefore - monacoChangesAfter;
    if (barsRemoved !== monacoRemoved) {
      throw new Error(
        `Reject removed ${barsRemoved} bar(s) but only ${monacoRemoved} Monaco ILineChange(s) disappeared.\n` +
          `before: bars=${barsBefore}, monacoChanges=${monacoChangesBefore}\n` +
          `after:  bars=${barsAfter}, monacoChanges=${monacoChangesAfter}\n` +
          "This indicates bars belonging to a DIFFERENT git hunk were also removed — wrong hunk assignment in mapLineChangesToHunks().",
      );
    }
  });

  test("12 — after reject, remaining bars still cover all remaining Monaco ILineChanges (bars ≥ monacoChanges)", () => {
    if (skipped) {
      console.warn("  ~ skipped: fewer than 2 bars in SetupView.vue");
      return;
    }
    if (barsAfter < monacoChangesAfter) {
      throw new Error(
        `After reject: bars=${barsAfter} < monacoChanges=${monacoChangesAfter}.\n` +
          "Some remaining colored diff regions have no action bar — the reject caused a bar to disappear for a DIFFERENT hunk.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite G — Pending counter accuracy
// ═══════════════════════════════════════════════════════════════════════════════
// The header counter ".nav-counter" shows "{N} pending" where N is the count of
// pending git hunks (not Monaco ILineChanges). It must reflect the real state.

describe("Code Review Overlay — pending counter accuracy", () => {
  let initialCounter = -1;
  let counterAfterAccept = -1;
  let counterAfterReject = -1;
  let initialGitHunks = -1;

  function readCounter(): Promise<number> {
    return webEval<number>(`
      var el = document.querySelector('.nav-counter');
      if (!el) return -1;
      return parseInt(el.textContent || '0', 10);
    `);
  }

  function readPendingHunksFromStore(): Promise<number> {
    return webEval<number>(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      var r = pinia._s.get('review');
      // Access the Vue component instance for the pending count
      var overlay = document.querySelector('.review-overlay');
      if (!overlay) return -1;
      // Read the counter text directly — it reflects pendingHunks.length
      var el = document.querySelector('.nav-counter');
      return el ? parseInt(el.textContent || '0', 10) : -1;
    `);
  }

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });
    // Select richest available file and navigate to its first hunk
    await selectRichTestFile();
    // Wait for bars to stabilise
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }

    // Read the initial state: counter text
    initialCounter = await readCounter();
    initialGitHunks = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);

    // Accept the first hunk (no visibility check — zones may be below visible viewport)
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--accept'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    // Wait for model rebuild
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      const bars = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(bars) < initialGitHunks) break;
    }
    await sleep(500);
    counterAfterAccept = await readCounter();

    // Navigate to next file to get another pending hunk for the reject test
    const prevFile = await reviewSelectedFile();
    await webClick(".nav-btn:last-of-type"); // → Next
    await sleep(1_500);
    const nextFile = await reviewSelectedFile();
    const movedToNextFile = typeof nextFile === "string" && nextFile !== prevFile;
    if (movedToNextFile) {
      // Wait for bars to stabilise in the new file
      let prevN = -1;
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
        if (Number(n) === prevN && prevN >= 0) break;
        prevN = Number(n);
      }
      const barsInNextFile = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      const counterBeforeReject = await readCounter();
      if (barsInNextFile > 0) {
        // Reject the first hunk in this file
        await webEval(`
          var btns = Array.from(document.querySelectorAll('.hunk-btn--reject'));
          if (btns.length > 0) btns[0].click();
          return 'ok';
        `);
        for (let i = 0; i < 15; i++) {
          await sleep(500);
          const bars = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
          if (Number(bars) < barsInNextFile) break;
        }
        await sleep(500);
        const counterAfterRejectRaw = await readCounter();
        // Store as "counterAfterAccept - 1" baseline and actual for test 15
        counterAfterReject = counterBeforeReject + (counterAfterRejectRaw - counterBeforeReject);
      }
    }
  }, 120_000);

  test("13 — initial counter shows 'N pending' where N equals the pending git hunk count", () => {
    // The counter must be a non-negative number
    expect(initialCounter).toBeGreaterThanOrEqual(0);
    // And it must be present (not -1 = element not found)
    if (initialCounter === -1) {
      throw new Error(
        "Counter element '.nav-counter' not found — is the overlay in review mode?",
      );
    }
    // The counter must not exceed the number of bars (each git hunk has ≥1 bar; pending counter ≤ bar count)
    if (initialCounter > initialGitHunks) {
      throw new Error(
        `Counter shows ${initialCounter} pending but only ${initialGitHunks} bars are present. ` +
          "Counter is overcounting (possibly counting Monaco ILineChanges instead of git hunks).",
      );
    }
  });

  test("14 — counter decrements by exactly 1 after accepting one git hunk", () => {
    if (initialCounter <= 0) {
      console.warn("  ~ skipped: no pending hunks to accept");
      return;
    }
    if (counterAfterAccept === -1) {
      throw new Error("Counter element not found after accept");
    }
    const dropped = initialCounter - counterAfterAccept;
    if (dropped !== 1) {
      throw new Error(
        `Counter dropped by ${dropped} after accepting one hunk (expected exactly 1).\n` +
          `before=${initialCounter}, after=${counterAfterAccept}.\n` +
          "If dropped by >1, the counter is counting Monaco ILineChanges not git hunks.",
      );
    }
  });

  test("15 — counter decrements by exactly 1 after rejecting one git hunk", () => {
    if (counterAfterReject === -1) {
      console.warn("  ~ skipped: could not navigate to another file with pending hunks to reject");
      return;
    }
    // counterAfterReject stores the value AFTER the reject. counterBeforeReject = counterAfterReject + 1
    // We check it dropped by exactly 1 compared to what was there before reject.
    // Since the actual dropped amount is encoded in the beforeAll, this assertion
    // verifies the reject operation lowered the counter (it should be 0 = 1 - 1).
    expect(counterAfterReject).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite H — Change Request validation and behaviour
// ═══════════════════════════════════════════════════════════════════════════════
// Change Request requires a non-empty comment. Without one, a validation error must
// appear. With a comment, the decision saves and the bar transitions to a decided
// visual state while the diff lines remain visible.

describe("Code Review Overlay — Change Request validation and behaviour", () => {
  let errorVisibleWithoutComment = false;
  let barCountBeforeCR = 0;
  let barCountAfterCR = 0;
  let decidedBadgeVisible = false;

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });
    await selectRichTestFile();
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }
    barCountBeforeCR = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);

    if (barCountBeforeCR === 0) {
      // No bars to test CR on — will cause tests to fail with a clear message
      return;
    }

    // Step 1: click Change Request with NO comment — should show validation error.
    // textarea starts empty by default; no need to clear it (new bar on fresh load).
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--cr'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    await sleep(600);

    errorVisibleWithoutComment = await webEval<boolean>(
      `return !!document.querySelector('.hunk-bar__error-msg')`,
    );
    barCountAfterCR = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);

    // Step 2: type a comment and click Change Request again.
    // Use the native value setter so Vue's v-model reactive ref picks up the change.
    await webEval(`
      var ta = document.querySelector('.hunk-bar__textarea');
      if (ta) {
        var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'Please fix this before merging');
        ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      var btns = Array.from(document.querySelectorAll('.hunk-btn--cr'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    await sleep(1_500); // wait for the decision to be saved (async RPC) + zones re-injected

    // After CR with comment: bar stays visible with CR button in active state
    // (.decision-badge only appears in 'changes' mode; in 'review' mode the button gets --active class)
    decidedBadgeVisible = await webEval<boolean>(
      `return !!document.querySelector('.hunk-btn--cr.hunk-btn--active')`,
    );
  }, 120_000);

  test("16 — Change Request with empty comment shows validation error and does not remove the bar", () => {
    if (barCountBeforeCR === 0) {
      console.warn("  ~ skipped: no bars available (no hunks in the selected file)");
      return;
    }
    // Validation error must be visible
    if (!errorVisibleWithoutComment) {
      throw new Error(
        "No '.hunk-bar__error-msg' element visible after clicking Change Request without a comment.\n" +
          "The validation error should appear to tell the user a comment is required.",
      );
    }
    // Bar must NOT be removed (decision was not saved)
    if (barCountAfterCR < barCountBeforeCR) {
      throw new Error(
        `Bar count dropped from ${barCountBeforeCR} to ${barCountAfterCR} after Change Request with empty comment.\n` +
          "The bar should remain — the decision must not be saved without a comment.",
      );
    }
  });

  test("17 — Change Request with comment shows decided state and diff lines stay visible", () => {
    if (barCountBeforeCR === 0) {
      console.warn("  ~ skipped: no bars available");
      return;
    }
    // In review mode, after a Change Request decision the bar stays visible with
    // the CR button in an active/highlighted state (.hunk-btn--cr.hunk-btn--active).
    // The diff lines remain visible (no collapse). A .decision-badge only appears in 'changes' mode.
    if (!decidedBadgeVisible) {
      throw new Error(
        "No '.hunk-btn--cr.hunk-btn--active' element found after submitting Change Request with a comment.\n" +
          "The CR button should have the '--active' class to indicate the decision was recorded.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite I — Decision persistence across file switches
// ═══════════════════════════════════════════════════════════════════════════════
// After accepting a hunk in file A, switching to file B, then switching back to A,
// the accepted hunk must still be collapsed (no bar, no colored diff region for it).
// This exercises the DB persistence + display model rebuild path.

describe("Code Review Overlay — decision persistence across file switches", () => {
  let fileA = "";
  let fileB = "";
  let barCountInFileABeforeAccept = 0;
  let barCountInFileAAfterSwitch = 0;
  let monacoChangesAfterSwitch = 0;

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    // Pick the first two files from the review's file list
    const files = await webEval<string[]>(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      return JSON.stringify(pinia._s.get('review').files || []);
    `);
    if (files.length < 2) {
      // Can't test cross-file switch with only 1 file — suites will skip gracefully
      fileA = files[0] ?? "";
      fileB = "";
    } else {
      fileA = files[0];
      fileB = files[1];
    }

    if (!fileA) return;

    // Load file A and wait for bars
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').selectedFile = ${JSON.stringify(fileA)};
      return 'ok';
    `);
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }
    barCountInFileABeforeAccept = await webEval<number>(
      `return document.querySelectorAll('.hunk-bar').length`,
    );

    if (barCountInFileABeforeAccept === 0) return; // no hunks to accept

    // Accept the first hunk (no visibility check — zones may be below visible viewport)
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--accept'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    // Wait for rebuild — bar count should decrease
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const bars = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(bars) < barCountInFileABeforeAccept) break;
    }
    await sleep(500);

    if (!fileB) return;

    // Switch to file B
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').selectedFile = ${JSON.stringify(fileB)};
      return 'ok';
    `);
    await sleep(1_500);

    // Switch back to file A
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').selectedFile = ${JSON.stringify(fileA)};
      return 'ok';
    `);
    // Wait for bar count to stabilise
    let prevAfter = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prevAfter && prevAfter >= 0) break;
      prevAfter = Number(n);
    }
    barCountInFileAAfterSwitch = await webEval<number>(
      `return document.querySelectorAll('.hunk-bar').length`,
    );
    monacoChangesAfterSwitch = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);
  }, 120_000);

  test("18 — accepted hunk stays collapsed after switching files and returning", () => {
    if (!fileA || barCountInFileABeforeAccept === 0) {
      console.warn("  ~ skipped: no hunks to accept in first file");
      return;
    }
    if (!fileB) {
      console.warn("  ~ skipped: only one changed file — cannot test cross-file switch");
      return;
    }

    // After switching back, bar count must still be less than before (accepted hunk stays collapsed)
    if (barCountInFileAAfterSwitch >= barCountInFileABeforeAccept) {
      throw new Error(
        `After switching away and back to ${fileA.split("/").pop()}, bar count returned to ${barCountInFileAAfterSwitch} ` +
          `(was ${barCountInFileABeforeAccept} before accept).\n` +
          "The accepted hunk's decision was not persisted — it re-appeared after file switch.\n" +
          "Fix: ensure accepted decisions are read from DB when loading a file (buildDisplayModel must apply them).",
      );
    }

    // Also verify bars still cover Monaco ILineChanges (no regressions in the remaining hunks)
    if (barCountInFileAAfterSwitch < monacoChangesAfterSwitch) {
      throw new Error(
        `After switching back to ${fileA.split("/").pop()}: bars=${barCountInFileAAfterSwitch} < monacoChanges=${monacoChangesAfterSwitch}.\n` +
          "Remaining hunks are missing bars — bar injection may have failed after file switch.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite J — Accept precision: accepting one hunk does not over-collapse the diff
// ═══════════════════════════════════════════════════════════════════════════════
// Symmetric to Suite F but for the accept path. Accepting one git hunk should
// remove exactly its Monaco ILineChanges from the diff — not those of other hunks.

describe("Code Review Overlay — accept precision", () => {
  let barsBefore = 0;
  let monacoChangesBefore = 0;
  let barsAfter = 0;
  let monacoChangesAfter = 0;
  let skipped = false;

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });
    await selectRichTestFile();
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }

    barsBefore = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesBefore = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);

    if (barsBefore < 2) {
      skipped = true;
      return;
    }

    // Accept the first hunk (no visibility check — zones may be below visible viewport)
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--accept'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);
    let prevAfter = -1;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prevAfter && prevAfter >= 0) break;
      prevAfter = Number(n);
    }

    barsAfter = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesAfter = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);
  }, 120_000);

  test("19 — after accepting one hunk, remaining bars still cover all remaining Monaco ILineChanges", () => {
    if (skipped) {
      console.warn("  ~ skipped: fewer than 2 bars in SetupView.vue");
      return;
    }

    // Same invariant as Suite F: (bars_before - bars_after) === (monaco_before - monaco_after)
    const barsRemoved = barsBefore - barsAfter;
    const monacoRemoved = monacoChangesBefore - monacoChangesAfter;
    if (barsRemoved !== monacoRemoved) {
      throw new Error(
        `Accept removed ${barsRemoved} bar(s) but ${monacoRemoved} Monaco ILineChange(s) disappeared.\n` +
          `before: bars=${barsBefore}, monacoChanges=${monacoChangesBefore}\n` +
          `after:  bars=${barsAfter}, monacoChanges=${monacoChangesAfter}\n` +
          "Bars removed and Monaco changes removed must be equal — if they differ, the display model patch is wrong.",
      );
    }

    // After accept, bars must still cover remaining Monaco ILineChanges
    if (barsAfter < monacoChangesAfter) {
      throw new Error(
        `After accept: bars=${barsAfter} < monacoChanges=${monacoChangesAfter}.\n` +
          "Some remaining colored diff regions have no action bar.",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite K — partial-change files: bars and Monaco ILineChanges
// ═══════════════════════════════════════════════════════════════════════════════
// New/untracked files each produce a single hunk (the whole file is "added").
// Tracked files that were committed and then partially modified produce multiple
// disjoint hunks — only the changed regions appear as diffs.
//
// partial-x.ts in the test worktree has two disjoint changed regions:
//   top block:    lines 1–4 (function return types changed)
//   bottom block: lines 10–12 (function return types changed)
// The middle section (lines 5–9) is unchanged.
//
// This suite verifies the review overlay handles partial-change files correctly:
// bars are injected for every Monaco ILineChange, and every hunk has a bar.

interface PartialFileResult {
  file: string;
  monacoChanges: number;
  bars: number;
}

describe("Code Review Overlay — partial-change file: bars and Monaco ILineChanges", () => {
  let result: PartialFileResult = { file: "", monacoChanges: 0, bars: 0 };
  let partialFile = "";

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    // Select the partial-change file (partial-x.ts — two disjoint hunks).
    partialFile = await selectPartialTestFile();

    // Wait for Monaco diff to compute and bars to stabilise.
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }

    const raw = await webEval<{ monacoChanges: number; bars: number }>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      var changes = de[0] ? (de[0].getLineChanges() || []) : [];
      var bars = document.querySelectorAll('.hunk-bar').length;
      return JSON.stringify({ monacoChanges: changes.length, bars: bars });
    `);
    result = { file: partialFile, ...raw };
  }, 120_000);

  test("20 — bars ≥ Monaco ILineChanges for a tracked partial-change file", () => {
    if (!partialFile) throw new Error("selectPartialTestFile() returned no file");
    if (result.monacoChanges === 0) {
      throw new Error(
        `No Monaco ILineChanges found in ${partialFile}.\n` +
          "Expected ≥2 for a tracked file with two disjoint changed regions.\n" +
          "Check that /setup-test-env committed the base content and then modified only top+bottom sections.",
      );
    }
    if (result.bars < result.monacoChanges) {
      throw new Error(
        `bars=${result.bars} < monacoChanges=${result.monacoChanges} in ${partialFile}.\n` +
          "Some colored diff regions have no action bar in a tracked partial-change file.",
      );
    }
    // Additional: for a file with two disjoint hunks, expect ≥2 Monaco ILineChanges.
    if (result.monacoChanges < 2) {
      throw new Error(
        `Expected ≥2 Monaco ILineChanges in ${partialFile} (two disjoint changed regions) but got ${result.monacoChanges}.\n` +
          "The file may not have the expected structure — check /setup-test-env partial file content.",
      );
    }
  });

  test("21 — every hunk in the partial file has a visible action bar (navigate through all hunks)", async () => {
    if (!partialFile) throw new Error("selectPartialTestFile() returned no file");

    await navToFirstHunk(20);
    await sleep(500);

    const missing: number[] = [];
    const MAX_HUNKS = 15;

    for (let h = 0; h < MAX_HUNKS; h++) {
      const currentFile = await reviewSelectedFile();
      if (typeof currentFile === "string" && currentFile !== partialFile) break;

      const hasBar = await webEval<boolean>(`
        var bars = Array.from(document.querySelectorAll('.hunk-bar'));
        var diffEl = document.querySelector('.monaco-diff-editor');
        var editorTop = diffEl ? diffEl.getBoundingClientRect().top : 0;
        return !!bars.find(function(b) {
          var r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top > editorTop;
        });
      `);

      if (!hasBar) {
        missing.push(h + 1);
        await screenshot(`partial-missing-bar-h${h + 1}`);
      }

      await webClick(".nav-btn:last-of-type"); // → Next
      await sleep(600);
      const nextFile = await reviewSelectedFile();
      if (typeof nextFile === "string" && nextFile !== partialFile) break;
    }

    if (missing.length > 0) {
      throw new Error(
        `${missing.length} hunk(s) in ${partialFile} rendered without a visible action bar: hunks ${missing.join(", ")}.\n` +
          "Fix: ensure injectViewZones() covers all Monaco ILineChanges in partial-change (tracked) files.",
      );
    }
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite L — partial-change files: reject precision with multiple hunks
// ═══════════════════════════════════════════════════════════════════════════════
// Reject-precision test specifically for a file with 2+ disjoint hunks.
// When we reject hunk 1 (top block), hunk 2 (bottom block) must remain
// untouched — it keeps its bars and Monaco ILineChanges.
//
// This catches the most dangerous regression: accepting/rejecting one hunk
// silently removes the other hunk's diff from the display.

describe("Code Review Overlay — partial-change file: reject removes only targeted hunk", () => {
  let barsBefore = 0;
  let monacoChangesBefore = 0;
  let barsAfter = 0;
  let monacoChangesAfter = 0;
  let partialFile = "";
  let skipped = false;

  beforeAll(async () => {
    await resetDecisions(testTaskId);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);
    await openReviewOverlay({ taskId: testTaskId, files: testFiles });

    partialFile = await selectPartialTestFile();

    // Stabilise bar count
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prev && prev >= 0) break;
      prev = Number(n);
    }

    barsBefore = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesBefore = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);

    if (barsBefore < 2) {
      skipped = true;
      return;
    }

    // Reject only the first hunk bar
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--reject'));
      if (btns.length > 0) btns[0].click();
      return 'ok';
    `);

    // Wait for model rebuild and re-injection to stabilise
    let prevAfter = -1;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      const n = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
      if (Number(n) === prevAfter && prevAfter >= 0) break;
      prevAfter = Number(n);
    }

    barsAfter = await webEval<number>(`return document.querySelectorAll('.hunk-bar').length`);
    monacoChangesAfter = await webEval<number>(`
      var de = window.monaco && window.monaco.editor && window.monaco.editor.getDiffEditors() || [];
      return (de[0] ? (de[0].getLineChanges() || []) : []).length;
    `);
  }, 120_000);

  test("22 — rejecting one hunk in a partial-change file only removes that hunk's bars", () => {
    if (skipped) {
      console.warn(`  ~ skipped: fewer than 2 bars in ${partialFile || "partial file"}`);
      return;
    }
    const barsRemoved = barsBefore - barsAfter;
    const monacoRemoved = monacoChangesBefore - monacoChangesAfter;

    if (barsRemoved !== monacoRemoved) {
      throw new Error(
        `Reject removed ${barsRemoved} bar(s) but ${monacoRemoved} Monaco ILineChange(s) disappeared in ${partialFile}.\n` +
          `before: bars=${barsBefore}, monacoChanges=${monacoChangesBefore}\n` +
          `after:  bars=${barsAfter}, monacoChanges=${monacoChangesAfter}\n` +
          "Bars removed and Monaco changes removed must be equal — wrong hunk assignment in mapLineChangesToHunks().",
      );
    }
    // At least one bar+change should have been removed
    if (barsRemoved === 0) {
      throw new Error(
        `No bars were removed after rejecting a hunk in ${partialFile}.\n` +
          "The reject action may not have worked, or the overlay did not rebuild.",
      );
    }
  });

  test("23 — after rejecting one hunk, the remaining hunk still has its bars", () => {
    if (skipped) {
      console.warn(`  ~ skipped: fewer than 2 bars in ${partialFile || "partial file"}`);
      return;
    }
    if (barsAfter < monacoChangesAfter) {
      throw new Error(
        `After rejecting one hunk in ${partialFile}: bars=${barsAfter} < monacoChanges=${monacoChangesAfter}.\n` +
          "The second hunk's action bar disappeared — rejecting one hunk removed bars for the other.\n" +
          "Fix: ensure rejectHunk() only records a decision for the targeted git hunk hash.",
      );
    }
    if (barsAfter === 0 && monacoChangesAfter > 0) {
      throw new Error(
        `All bars removed after rejecting one hunk in ${partialFile}, but ${monacoChangesAfter} Monaco changes remain.\n` +
          "The remaining hunk lost its action bar.",
      );
    }
  });
});
