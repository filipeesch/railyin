/**
 * review-overlay.test.ts — UI regression tests for the code review overlay.
 *
 * Test runner: bun test  (bun:test)
 * Transport:   HTTP bridge to Electrobun debug server on localhost:9229
 *
 * Run: bun test src/ui-tests --timeout 60000
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
  navToFirstHunk,
  resetDecisions,
  screenshot,
} from "./bridge";

// ═══════════════════════════════════════════════════════════════════════════════
// Suite A — shared setup: overlay open on SetupView.vue, first hunk in viewport
// ═══════════════════════════════════════════════════════════════════════════════

describe("Code Review Overlay — ViewZone UX", () => {
  beforeAll(async () => {
    // Verify the app is running before doing anything
    const ping = await fetch(BRIDGE_BASE + "/").catch(() => null);
    if (!ping?.ok) throw new Error("App not running — start it with: bun run dev");

    await openReviewOverlay();
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

describe("Code Review Overlay — per-hunk navigation (SetupView.vue)", () => {
  const hunkResults: HunkResult[] = [];
  let capturedScreenshot = false;

  beforeAll(async () => {
    // Clear persisted hunk decisions from DB and in-memory optimistic state
    await resetDecisions(1);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

    // Switch to (or stay on) SetupView.vue and wait for diff to load
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').selectedFile = 'src/mainview/views/SetupView.vue';
      return 'ok';
    `);
    await sleep(1_500);

    // Navigate to the very first pending hunk in SetupView.vue
    await navToFirstHunk(20);
    await sleep(500);

    // Walk through all hunks in SetupView.vue and collect measurement data
    const MAX_HUNKS = 15;

    for (let h = 0; h < MAX_HUNKS; h++) {
      const currentFile = await reviewSelectedFile();
      if (typeof currentFile === "string" && !currentFile.includes("SetupView")) break;

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

      // Navigate to next hunk; stop when we leave SetupView.vue
      await webClick(".nav-btn:last-of-type"); // → Next
      await sleep(600);
      const nextFile = await reviewSelectedFile();
      if (typeof nextFile === "string" && !nextFile.includes("SetupView")) break;
    }
  }, 180_000); // 3 min — navigation loop can take up to ~2.5 min for 15 hunks

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
    await resetDecisions(1);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

    // Navigate to SetupView.vue and its first hunk
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').selectedFile = 'src/mainview/views/SetupView.vue';
      return 'ok';
    `);
    await sleep(1_500);
    await navToFirstHunk(20);
    await sleep(600);
    await waitForZones(8_000);

    // Count bars before rejecting
    barCountBefore = await webEval<number>(
      `return document.querySelectorAll('.hunk-bar').length`,
    );

    // Click the reject button on the first visible bar
    await webEval(`
      var btns = Array.from(document.querySelectorAll('.hunk-btn--reject'));
      for (var i = 0; i < btns.length; i++) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { btns[i].click(); break; }
      }
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
    if (barCountAfter >= barCountBefore) {
      throw new Error(
        `Bar count did not decrease after reject: before=${barCountBefore}, after=${barCountAfter}. ` +
          "The rejected hunk ViewZone may not have been removed.",
      );
    }
    expect(barCountAfter).toBe(barCountBefore - 1);
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
    // Clean slate
    await resetDecisions(1);
    await webEval(`
      var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
      pinia._s.get('review').optimisticUpdates.clear();
      return 'cleared';
    `);

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
          "\nFix: ensure correlateHunks() successfully maps every git hunk to a Monaco ILineChange.",
      );
    }
  });
});
