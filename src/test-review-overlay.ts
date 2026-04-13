#!/usr/bin/env bun
/**
 * test-review-overlay.ts — Automated UX tests for the code review overlay
 *
 * Exercises the ViewZone fixes:
 *   1. z-index: accept/reject buttons are top element at their center
 *   2. Height: zone domNode height matches content (not stuck at 108px)
 *   3. Scroll restore: scrollTop stays put after Accept/Reject
 *   4. Viewport clip: first pending hunk is not hidden above the editor header
 *
 * Usage: bun src/test-review-overlay.ts
 * Requires the app to be running (bun run dev).
 */

// Make this file a module so top-level await is valid in TypeScript
export {};
import { readFileSync } from "node:fs";

const debugPort = (() => {
  try {
    const n = parseInt(readFileSync("/tmp/railyn-debug.port", "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 9229;
  } catch { return 9229; }
})();
const BASE = `http://localhost:${debugPort}`;
let passed = 0;
let failed = 0;

// ─── transport ────────────────────────────────────────────────────────────────

function q(s: string) { return JSON.stringify(s); }

async function webEval<T = unknown>(script: string): Promise<T> {
  const res = script.length > 1000
    ? await fetch(BASE + "/inspect", { method: "POST", body: script, headers: { "content-type": "text/plain" } })
    : await fetch(`${BASE}/inspect?script=${encodeURIComponent(script)}`);
  if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  // WebView scripts return JSON.stringify(...); server wraps that string in another JSON.stringify.
  // One parse gives us the inner JSON string — try a second parse to get the real value.
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
  }
  if (parsed && typeof parsed === "object" && "__error" in (parsed as Record<string, unknown>)) {
    throw new Error(`JS error: ${(parsed as { __error: string }).__error}`);
  }
  return parsed as T;
}

async function webClick(selector: string) {
  const res = await fetch(`${BASE}/click?selector=${encodeURIComponent(selector)}`);
  return res.text();
}

async function screenshot(label: string) {
  const path = `/tmp/railyn-test-${label}-${Date.now()}.png`;
  try {
    const res = await fetch(`${BASE}/screenshot?path=${encodeURIComponent(path)}`);
    const data = await res.json() as { path?: string; __error?: string };
    if (data.__error) { console.log(`  📷 screenshot failed: ${data.__error}`); return; }
    console.log(`  📷 screenshot → ${data.path}`);
  } catch (e) {
    console.log(`  📷 screenshot error: ${e}`);
  }
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(selector: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await webEval<number>(`return document.querySelectorAll(${q(selector)}).length`);
    if (Number(count) > 0) return true;
    await sleep(200);
  }
  return false;
}

// ─── test runner ─────────────────────────────────────────────────────────────

async function assert(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>) {
  try {
    const { ok, detail } = await fn();
    if (ok) {
      console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` (${detail})` : ""}`);
      passed++;
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${name} — threw: ${e instanceof Error ? e.message : e}`);
    failed++;
  }
}

// ─── setup ────────────────────────────────────────────────────────────────────

const ping = await fetch(BASE + "/").catch(() => null);
if (!ping?.ok) {
  console.error("App not running. Start with: bun run dev");
  process.exit(1);
}

console.log("\x1b[1mSetup\x1b[0m: closing any open overlay...");
await webEval(`
  const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.['$pinia'];
  const r = pinia?._s.get('review');
  if (r?.isOpen) r.closeReview();
  return 'ok';
`);
await sleep(400);

// Reset all hunk decisions so each test run starts from a clean state
await fetch(`${BASE}/reset-decisions?taskId=1`);
await sleep(200);

// Ensure the changed-files badge is populated (may be empty if no drawer was opened)
console.log("\x1b[1mSetup\x1b[0m: refreshing changed-file counts for task 1...");
await webEval(`
  return new Promise(async (resolve) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    const ts = pinia._s.get('task');
    await ts.refreshChangedFiles(1);
    resolve('ok');
  });
`);
await sleep(400);

console.log("\x1b[1mSetup\x1b[0m: opening Dark Mode review via changed-badge...");
await webClick(".task-card__changed-badge");
const opened = await waitFor(".review-overlay", 5000);
if (!opened) {
  const count = await webEval<number>(`return document.querySelectorAll('.task-card__changed-badge').length`);
  console.error(`Review overlay did not open (${count} badges found). Aborting.`);
  process.exit(1);
}
await sleep(1000); // wait for diff to load

// Navigate to a content-rich file for richer testing (prefer SetupView > BoardView > any .vue)
console.log("\x1b[1mSetup\x1b[0m: selecting file with most pending hunks...");
const bestFile = await webEval<string>(`
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
  const r = pinia._s.get('review');
  var files = r.files;
  if (!files || !files.length) return 'no files';
  var best = files.find(function(f) { return f.includes('SetupView'); })
    || files.find(function(f) { return f.includes('BoardView'); })
    || files.find(function(f) { return f.endsWith('.vue'); })
    || files[0];
  r.selectedFile = best;
  return best;
`);
console.log(`  → ${bestFile}`);
await sleep(1200);

// Navigate to the first pending hunk so Monaco scrolls to it and renders viewzones
console.log("\x1b[1mSetup\x1b[0m: navigating to first hunk to trigger zone layout...");
await webClick(".nav-btn");
await sleep(600);

// Wait until at least one zone container has non-zero height (layoutZone fired)
{
  let zonesReady = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    const hasHeight = await webEval<boolean>(`
      return !!Array.from(document.querySelectorAll('.hunk-bar')).find(function(b) {
        return b.parentElement && parseInt(b.parentElement.style.height) > 0;
      });
    `);
    if (hasHeight) { zonesReady = true; break; }
    await sleep(200);
  }
  if (!zonesReady) console.warn("  ⚠ zones still not laid out after 5s");
}

// ─── Test 1: z-index ──────────────────────────────────────────────────────────

console.log("\n\x1b[1mTest 1: ViewZone z-index (click interception)\x1b[0m");

await assert("first accept button is top element at its center", async () => {
  const result = await webEval<{ isSameElement: boolean; hitCls: string }>(`
    const btn = document.querySelector('.hunk-btn--accept');
    if (!btn) return JSON.stringify({ isSameElement: false, hitCls: 'no button found' });
    const r = btn.getBoundingClientRect();
    // Button not rendered by Monaco (still virtualized) — not a z-index failure
    if (r.width === 0) return JSON.stringify({ isSameElement: true, hitCls: 'skipped: button not in viewport' });
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    return JSON.stringify({ isSameElement: hit === btn, hitCls: hit ? hit.className.slice(0,60) : 'null' });
  `);
  return { ok: result.isSameElement, detail: result.isSameElement ? result.hitCls.startsWith('skipped') ? result.hitCls : undefined : `hit: ${result.hitCls}` };
});

await assert("all visible accept buttons are hittable", async () => {
  const results = await webEval<{ i: number; ok: boolean; hitCls: string }[]>(`
    return JSON.stringify(Array.from(document.querySelectorAll('.hunk-btn--accept')).map(function(btn, i) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { i: i, ok: true, hitCls: 'virtualized-skip' };
      const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return { i: i, ok: hit === btn, hitCls: hit ? hit.className.slice(0,50) : 'null' };
    }));
  `);
  const failures = results.filter(function(r) { return !r.ok && r.hitCls !== "virtualized-skip"; });
  return {
    ok: failures.length === 0,
    detail: failures.length
      ? `button[${failures.map(function(f) { return f.i; }).join(",")}] intercepted by "${failures[0].hitCls}"`
      : `${results.length} buttons checked`,
  };
});

// ─── Test 2: zone heights ─────────────────────────────────────────────────────

console.log("\n\x1b[1mTest 2: ViewZone height measurement\x1b[0m");

await assert("visible hunk-bar zones have height > 0", async () => {
  const bars = await webEval<{ i: number; parentH: string; barH: number }[]>(`
    return JSON.stringify(Array.from(document.querySelectorAll('.hunk-bar')).map(function(b, i) {
      return { i: i, parentH: b.parentElement ? b.parentElement.style.height : 'n/a', barH: b.offsetHeight };
    }));
  `);
  if (!bars.length) return { ok: false, detail: "no hunk-bars found" };
  const visible = bars.filter(function(b) { return parseInt(b.parentH) > 0; });
  if (!visible.length) return { ok: false, detail: "all zones have height 0 (may need to scroll)" };
  const zeros = visible.filter(function(b) { return b.barH === 0; });
  return {
    ok: zeros.length === 0,
    detail: `${visible.length} visible zones, ${zeros.length} with zero offsetHeight`,
  };
});

await assert("zone height is not stuck at Monaco default (108px)", async () => {
  const bars = await webEval<{ parentH: string }[]>(`
    return JSON.stringify(Array.from(document.querySelectorAll('.hunk-bar')).map(function(b) {
      return { parentH: b.parentElement ? b.parentElement.style.height : '0px' };
    }));
  `);
  const heights = bars.map(function(b) { return parseInt(b.parentH); }).filter(function(h) { return h > 0; });
  const stuck = heights.filter(function(h) { return h === 108; });
  return {
    ok: stuck.length === 0,
    detail: stuck.length ? `${stuck.length} zone(s) stuck at 108px` : `heights: ${heights.join(", ")}px`,
  };
});

// ─── Test 3: scroll restore after Accept ─────────────────────────────────────

console.log("\n\x1b[1mTest 3: Scroll position preserved after Accept\x1b[0m");

// Navigate to the second hunk to get a non-zero scroll position
await webClick(".nav-btn:last-of-type");
await sleep(800);

const scrollBeforeAccept = await webEval<number>(`
  return Array.from(document.querySelectorAll('.monaco-scrollable-element'))
    .reduce(function(max, s) { return Math.max(max, s.scrollTop); }, 0);
`);
const hunkCountBefore = await webEval<number>(`return document.querySelectorAll('.hunk-btn--accept').length`);

if (Number(hunkCountBefore) === 0) {
  console.log("  \x1b[33m~\x1b[0m scroll restore — skipped: no pending accept buttons");
} else {
  // Click the first visible accept button
  await webEval(`
    const btns = Array.from(document.querySelectorAll('.hunk-btn--accept'));
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { btn.click(); return 'clicked'; }
    }
    return 'none visible';
  `);
  await sleep(1800); // wait for model rebuild + scroll restore

  const scrollAfterAccept = await webEval<number>(`
    return Array.from(document.querySelectorAll('.monaco-scrollable-element'))
      .reduce(function(max, s) { return Math.max(max, s.scrollTop); }, 0);
  `);

  await assert("scrollTop within 80px of pre-accept position", async () => {
    const before = Number(scrollBeforeAccept);
    const after = Number(scrollAfterAccept);
    const delta = Math.abs(before - after);
    return {
      ok: delta < 80,
      detail: `before=${Math.round(before)}, after=${Math.round(after)}, delta=${Math.round(delta)}`,
    };
  });
}

// ─── Test 4: viewport clip after navigation ───────────────────────────────────

console.log("\n\x1b[1mTest 4: First pending hunk visible after Prev navigation\x1b[0m");

await webClick(".nav-btn"); // ← Prev
await sleep(700);

await assert("first hunk-bar is not above the Monaco editor viewport", async () => {
  const result = await webEval<{ barTop: number; editorTop: number; diff: number }>(`
    const bars = Array.from(document.querySelectorAll('.hunk-bar'));
    const visible = bars.filter(function(b) { return b.offsetHeight > 0; });
    if (!visible.length) return JSON.stringify({ barTop: -1, editorTop: 0, diff: 0 });
    const bar = visible[0];
    const editor = document.querySelector('.monaco-editor');
    const br = bar.getBoundingClientRect();
    const er = editor ? editor.getBoundingClientRect() : { top: 0 };
    return JSON.stringify({ barTop: Math.round(br.top), editorTop: Math.round(er.top), diff: Math.round(br.top - er.top) });
  `);
  if (result.barTop === -1) return { ok: false, detail: "no visible hunk bars found" };
  const TOLERANCE = 20;
  return {
    ok: result.diff >= -TOLERANCE,
    detail: `barTop=${result.barTop}, editorTop=${result.editorTop}, diff=${result.diff}px`,
  };
});

// ─── Test 5 + 6: per-hunk navigation — diffs without dialog + alignment ─────

console.log("\n\x1b[1mTest 5: Every hunk has a visible action bar (no diffs without dialog)\x1b[0m");
console.log("\x1b[1mTest 6: Each action bar aligns with its diff highlight (≤ 36px gap)\x1b[0m");

{
  // Clear all optimistic updates so we start fresh (removes accepted hunks from test 3)
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    pinia._s.get('review').optimisticUpdates.clear();
    return 'cleared';
  `);

  // Switch to SetupView.vue — fresh load with no accepted hunks
  await webEval(`
    var pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    pinia._s.get('review').selectedFile = 'src/mainview/views/SetupView.vue';
    return 'ok';
  `);
  await sleep(1500); // wait for diff re-load + zone injection

  // Return to first hunk by pressing ← Prev until file changes (we went back one file), then go forward
  for (let i = 0; i < 15; i++) {
    const fileBefore = await webEval<string>(
      `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').selectedFile`,
    );
    await webClick(".nav-btn"); // ← Prev
    await sleep(450);
    const fileAfter = await webEval<string>(
      `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').selectedFile`,
    );
    if (fileAfter !== fileBefore) {
      // Went to previous file — go back forward to SetupView.vue first hunk
      await webClick(".nav-btn:last-of-type"); // → Next
      await sleep(700);
      break;
    }
  }
  await sleep(500);

  // Loop through hunks: check bar presence + alignment at each step
  const MAX_HUNKS = 12;
  let missingBars = 0;
  let alignmentFailures: { hunk: number; gap: number; bar: number; insert: number; diag: string }[] = [];
  let firstAlignScreenshot = false;
  let hunkCount = 0;

  for (let h = 0; h < MAX_HUNKS; h++) {
    const fileBefore = await webEval<string>(
      `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').selectedFile`,
    );
    if (typeof fileBefore === "string" && !fileBefore.includes("SetupView")) break; // left file

    const result = await webEval<{
      hasBar: boolean; barTop: number; barH: number;
      gap: number; insertBottom: number; lineInserts: number;
    }>(`
      var bars = Array.from(document.querySelectorAll('.hunk-bar'));
      var visBar = null;
      var diffEditor = document.querySelector('.inline-review-editor');
      var editorTop = diffEditor ? diffEditor.getBoundingClientRect().top : 0;
      for (var i = 0; i < bars.length; i++) {
        var r = bars[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top > editorTop) { visBar = bars[i]; break; }
      }
      var inserts = Array.from(document.querySelectorAll('.inline-review-insertion'));
      var deleteds = Array.from(document.querySelectorAll('.inline-review-deletion-zone'));
      var barTop = visBar ? Math.round(visBar.getBoundingClientRect().top) : -1;
      var barH   = visBar ? Math.round(visBar.getBoundingClientRect().height) : 0;
      // Find the closest insert or delete bottom that is above the bar
      var nearBot = -1, minGap = 1e9;
      inserts.concat(deleteds).forEach(function(el) {
        var bot = Math.round(el.getBoundingClientRect().bottom);
        if (barTop >= 0 && bot <= barTop && barTop - bot < minGap) {
          minGap = barTop - bot; nearBot = bot;
        }
      });
      return JSON.stringify({
        hasBar: !!visBar, barTop: barTop, barH: barH,
        gap: nearBot >= 0 ? barTop - nearBot : -1,
        insertBottom: nearBot,
        lineInserts: inserts.length,
      });
    `);

    hunkCount++;
    const hunkLabel = `  hunk ${h + 1}`;
    if (!result.hasBar) {
      missingBars++;
      console.log(`${hunkLabel}: \x1b[31m✗ NO DIALOG\x1b[0m (${result.lineInserts} diff regions visible)`);
      if (!firstAlignScreenshot) { firstAlignScreenshot = true; await screenshot(`no-dialog-h${h + 1}`); }
    } else if (result.gap < 0) {
      console.log(`${hunkLabel}: \x1b[33m~\x1b[0m bar at ${result.barTop}px (no insert/delete above — add-only hunk?)`);
    } else if (result.gap > 36) {
      alignmentFailures.push({ hunk: h + 1, gap: result.gap, bar: result.barTop, insert: result.insertBottom, diag: "" });
      console.log(`${hunkLabel}: \x1b[31m✗ MISALIGNED\x1b[0m bar=${result.barTop}px, nearest_decor_bot=${result.insertBottom}px, gap=${result.gap}px`);
      if (!firstAlignScreenshot) { firstAlignScreenshot = true; await screenshot(`misalign-h${h + 1}`); }
    } else {
      console.log(`${hunkLabel}: \x1b[32m✓\x1b[0m bar=${result.barTop}px, gap=${result.gap}px`);
    }

    // Navigate to next; stop when we leave SetupView.vue
    await webClick(".nav-btn:last-of-type"); // → Next
    await sleep(600);
    const fileAfter = await webEval<string>(
      `return document.querySelector('#app').__vue_app__.config.globalProperties['$pinia']._s.get('review').selectedFile`,
    );
    if (typeof fileAfter === "string" && !fileAfter.includes("SetupView")) break; // moved to next file
  }

  await assert(`all ${hunkCount} hunks have a visible action bar`, async () => ({
    ok: missingBars === 0,
    detail: missingBars === 0 ? `${hunkCount} hunks checked` : `${missingBars}/${hunkCount} hunks missing dialog`,
  }));

  await assert(`all action bars align with diff highlights (≤ 36px gap)`, async () => ({
    ok: alignmentFailures.length === 0,
    detail: alignmentFailures.length === 0
      ? `${hunkCount} hunks checked`
      : alignmentFailures.map(function(f) { return `hunk ${f.hunk}: ${f.gap}px gap`; }).join("; "),
  }));
}

// ─── Summary ─────────────────────────────────────────────────────────────────

// ─── Test 7: Reject hunk — no green area, hunk count decreases ───────────────

console.log("\n\x1b[1mTest 7: Reject hunk — hunk removed, remaining bars stay aligned\x1b[0m");

{
  // Reset DB so we start with the full hunk set
  await fetch(`${BASE}/reset-decisions?taskId=1`);
  await sleep(200);

  // Close and re-open the review overlay to pick up the fresh DB state
  await webEval(`
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    const r = pinia._s.get('review');
    r.optimisticUpdates.clear();
    if (r.isOpen) r.closeReview();
  `);
  await sleep(400);
  await webClick(".task-card__changed-badge");
  await waitFor(".review-overlay", 5000);
  await sleep(1200);

  // Navigate to SetupView.vue and to the first hunk
  await webEval(`
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties['$pinia'];
    const r = pinia._s.get('review');
    var best = r.files.find(function(f) { return f.includes('SetupView'); }) || r.files[0];
    r.selectedFile = best;
  `);
  await sleep(1200);
  await webClick(".nav-btn"); // Prev → first hunk
  await sleep(600);

  // Count visible hunk bars before reject
  const hunksBefore = await webEval<number>(`
    var diffEditor = document.querySelector('.inline-review-editor');
    var editorTop = diffEditor ? diffEditor.getBoundingClientRect().top : 0;
    return Array.from(document.querySelectorAll('.hunk-bar')).filter(function(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= editorTop;
    }).length;
  `);

  // Click Reject on the first visible hunk bar
  await webClick(".hunk-btn--reject");
  await sleep(2500); // wait for RPC + git apply + model rebuild

  // Count visible hunk bars after reject — should be one fewer
  const hunksAfter = await webEval<number>(`
    var diffEditor = document.querySelector('.inline-review-editor');
    var editorTop = diffEditor ? diffEditor.getBoundingClientRect().top : 0;
    return Array.from(document.querySelectorAll('.hunk-bar')).filter(function(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= editorTop;
    }).length;
  `);

  await assert("reject removes the hunk from the pending list", async () => ({
    ok: hunksAfter < hunksBefore,
    detail: `before=${hunksBefore}, after=${hunksAfter}`,
  }));

  // Verify the remaining visible hunk bar is still properly aligned (no spurious green area)
  // A huge green area would push the bar far below the diff decoration.
  const alignResult = await webEval<{ hasBar: boolean; barTop: number; gap: number; insertBottom: number }>(`
    var bars = Array.from(document.querySelectorAll('.hunk-bar'));
    var visBar = null;
    var diffEditor = document.querySelector('.inline-review-editor');
    var editorTop = diffEditor ? diffEditor.getBoundingClientRect().top : 0;
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top > editorTop) { visBar = bars[i]; break; }
    }
    var barTop = visBar ? Math.round(visBar.getBoundingClientRect().top) : -1;
    var inserts = Array.from(document.querySelectorAll('.inline-review-insertion'));
    var deleteds = Array.from(document.querySelectorAll('.inline-review-deletion-zone'));
    var nearBot = -1, minGap = 1e9;
    inserts.concat(deleteds).forEach(function(el) {
      var bot = Math.round(el.getBoundingClientRect().bottom);
      if (barTop >= 0 && bot <= barTop && barTop - bot < minGap) {
        minGap = barTop - bot; nearBot = bot;
      }
    });
    return JSON.stringify({
      hasBar: !!visBar, barTop: barTop,
      gap: nearBot >= 0 ? barTop - nearBot : -1, insertBottom: nearBot
    });
  `);

  await assert("remaining hunk bar aligns with diff after reject (≤ 36px gap)", async () => {
    const ok = !alignResult.hasBar || alignResult.gap < 0 || alignResult.gap <= 36;
    if (!ok) await screenshot("reject-alignment");
    return {
      ok,
      detail: alignResult.hasBar
        ? `bar=${alignResult.barTop}px, gap=${alignResult.gap}px`
        : "no hunk bar visible (all hunks resolved)",
    };
  });
}

console.log(`\n${"─".repeat(48)}`);
const total = passed + failed;
console.log(
  `${total} test${total !== 1 ? "s" : ""}: `
  + `\x1b[32m${passed} passed\x1b[0m, `
  + (failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : `${failed} failed`)
);
if (failed > 0) process.exit(1);
