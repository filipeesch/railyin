// Run with: bun src/debug-inspect.ts
// Queries the debug HTTP server running inside the app
import { readFileSync } from "node:fs";

const debugPort = (() => {
  try {
    const n = parseInt(readFileSync("/tmp/railyn-debug.port", "utf8").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 9229;
  } catch { return 9229; }
})();
const BASE = `http://localhost:${debugPort}`;

async function inspect(script: string): Promise<unknown> {
  const url = new URL(BASE + "/inspect");
  url.searchParams.set("script", script);
  const res = await fetch(url.toString());
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function click(selector: string): Promise<unknown> {
  const url = new URL(BASE + "/click");
  url.searchParams.set("selector", selector);
  const res = await fetch(url.toString());
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ── 1. Check what the review overlay looks like ──────────────────────────────

console.log("=== 1. Basic presence check ===");
const presence = await inspect(`
  return JSON.stringify({
    hunkBar: !!document.querySelector('.hunk-bar'),
    hunkBtnAccept: !!document.querySelector('.hunk-btn--accept'),
    hunkBtnReject: !!document.querySelector('.hunk-btn--reject'),
    monacoZone: !!document.querySelector('[monaco-view-zone]'),
    reviewOverlay: !!document.querySelector('.code-review-overlay'),
    allButtons: Array.from(document.querySelectorAll('button')).map(b => b.className + ' | ' + b.textContent?.trim().slice(0,20))
  })
`);
console.log(JSON.stringify(presence, null, 2));

// ── 2. If buttons exist, check styles ────────────────────────────────────────

if (typeof presence === "string" && presence.includes("hunkBtnAccept\":true")) {
  console.log("\n=== 2. Button styles ===");
  const styles = await inspect(`
    function s(el) {
      if (!el) return null;
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        pointerEvents: c.pointerEvents,
        visibility: c.visibility,
        display: c.display,
        opacity: c.opacity,
        zIndex: c.zIndex,
        overflow: c.overflow,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      };
    }
    const btn = document.querySelector('.hunk-btn--accept');
    const bar = document.querySelector('.hunk-bar');
    const zone = document.querySelector('[monaco-view-zone]');
    const zoneParent = zone && zone.parentElement;
    return JSON.stringify({ btn: s(btn), bar: s(bar), zone: s(zone), zoneParent: s(zoneParent) })
  `);
  console.log(JSON.stringify(styles, null, 2));

  // ── 3. Simulate a click ────────────────────────────────────────────────────
  console.log("\n=== 3. Simulated click on accept button ===");
  const clickResult = await click(".hunk-btn--accept");
  console.log(clickResult);

  // ── 4. Check if handleDecide fired (via window.__debugLogs) ──────────────
  await new Promise(r => setTimeout(r, 500));
  console.log("\n=== 4. Debug logs captured ===");
  const logs = await inspect(`return JSON.stringify(window.__debugLogs || 'no __debugLogs')`);
  console.log(logs);

} else {
  console.log("\nButtons not found in DOM. Check if code review overlay is open.");
  
  // Check what's actually in the DOM
  console.log("\n=== DOM snapshot ===");
  const snapshot = await inspect(`
    return document.body.innerHTML.slice(0, 3000)
  `);
  console.log(snapshot);
}
