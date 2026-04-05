#!/usr/bin/env bun
/**
 * debug-cli.ts — WebView DOM inspector & interaction tool
 *
 * Usage:
 *   bun src/debug-cli.ts <command> [args]
 *
 * Commands:
 *   find    <selector>           Element count + first match styles
 *   all     <selector>           All matching elements with rects
 *   nth     <selector> <n>       Nth match (0-based) styles + HTML
 *   count   <selector>           Just print the element count
 *   styles  <selector>           Full computed style snapshot of element
 *   rect    <selector>           Bounding rect of element
 *   hit     <selector>           elementFromPoint at element center
 *   stack   <selector>           z-index stacking context chain up to body
 *   clip    <selector>           Find ancestors with overflow != visible
 *   path    <selector>           Full DOM ancestor path with tag/class/rect
 *   html    <selector>           outerHTML of element (first 2000 chars)
 *   click   <selector>           Simulate real mousedown+mouseup+click on element
 *   eval    <js>                 Evaluate arbitrary JS in the webview ('-' reads from stdin)
 *   logs                         Print window.__debugLogs if captured
 *   buttons                      List all buttons with class + text
 *   snapshot                     Compact DOM snapshot of body (3000 chars)
 *   hittest <x> <y>              elementFromPoint at absolute coords
 *   waitfor <selector> [ms]      Poll until element appears (default: 5000ms)
 *   listen  <selector> <event>   Add event listener and poll for 5s to see if it fires
 *   layers  <selector>           Check every ancestor for visibility/opacity/pointer-events
 *   vue     <selector>           Try to get Vue component __vueParentComponent data
 *   scroll  <selector>           scrollHeight vs offsetHeight vs clientHeight
 *   store   <name> [keyPath]     Read Pinia store (e.g. store review selectedFile)
 *   screenshot [path]            Capture the screen (default: /tmp/railyn-debug-*.png)
 *   hunkdiag                     Diagnose hunk-bar vs diff decoration alignment
 *
 * The debug HTTP server must be running (app started with bun run dev).
 * Server is at http://localhost:9229
 */

// Make this file a module so top-level await works in TypeScript
export {};

const BASE = "http://localhost:9229";

// ─── transport ───────────────────────────────────────────────────────────────

async function webEval(script: string): Promise<unknown> {
  // Use POST for long scripts to avoid URL length limits
  const res = script.length > 1000
    ? await fetch(BASE + "/inspect", {
        method: "POST",
        body: script,
        headers: { "content-type": "text/plain" },
      })
    : await fetch(`${BASE}/inspect?script=${encodeURIComponent(script)}`);

  if (!res.ok) {
    let body = await res.text();
    try { body = (JSON.parse(body) as { __error?: string }).__error ?? body; } catch {}
    throw new Error(`Server error: ${body}`);
  }

  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  // Server wraps scripts in try/catch and returns {__error} on JS exceptions
  if (parsed && typeof parsed === "object" && "__error" in (parsed as Record<string, unknown>)) {
    throw new Error(`WebView JS error: ${(parsed as { __error: string }).__error}`);
  }

  return parsed;
}

async function webClick(selector: string): Promise<unknown> {
  const url = new URL(BASE + "/click");
  url.searchParams.set("selector", selector);
  const res = await fetch(url.toString());
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function q(s: string) { return JSON.stringify(s); }

// stringify result coming from webview (it may itself be a JSON string)
function pretty(v: unknown): string {
  if (typeof v === "string") {
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
  }
  return JSON.stringify(v, null, 2);
}

function jsStyles(sel: string, extra = "") {
  return (
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const cs = getComputedStyle(el);`
    + `const r = el.getBoundingClientRect();`
    + extra
  );
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdAll(sel: string) {
  const res = await webEval(
    `const all = document.querySelectorAll(${q(sel)});`
    + `if (!all.length) return ${q("NOT FOUND: " + sel)};`
    + `return JSON.stringify(Array.from(all).map(function(el, i) {`
    + `  const r = el.getBoundingClientRect();`
    + `  const cs = getComputedStyle(el);`
    + `  return { i, tag: el.tagName, cls: el.className.slice(0,60),`
    + `    rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)},`
    + `    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,`
    + `    scrollH: el.scrollHeight, offsetH: el.offsetHeight };`
    + `}))`
  );
  console.log(pretty(res));
}

async function cmdNth(sel: string, n: number) {
  const res = await webEval(
    `const all = document.querySelectorAll(${q(sel)});`
    + `const el = all[${n}];`
    + `if (!el) return 'index ${n} out of range: ' + all.length + ' elements';`
    + `const r = el.getBoundingClientRect();`
    + `const cs = getComputedStyle(el);`
    + `return JSON.stringify({ i: ${n}, total: all.length, tag: el.tagName, cls: el.className.slice(0,80),`
    + `  rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)},`
    + `  display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents,`
    + `  scrollH: el.scrollHeight, offsetH: el.offsetHeight,`
    + `  html: el.outerHTML.slice(0, 500) })`
  );
  console.log(pretty(res));
}

async function cmdCount(sel: string) {
  const res = await webEval(`return document.querySelectorAll(${q(sel)}).length`);
  console.log(res);
}

async function cmdFind(sel: string) {
  const res = await webEval(
    `const all = document.querySelectorAll(${q(sel)});`
    + `const el = all[0];`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const cs = getComputedStyle(el);`
    + `const r = el.getBoundingClientRect();`
    + `return JSON.stringify({ count: all.length, tag: el.tagName, cls: el.className.slice(0,80), `
    + `rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, `
    + `display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex })`
  );
  console.log(pretty(res));
}

async function cmdStyles(sel: string) {
  const res = await webEval(
    jsStyles(sel)
    + `return JSON.stringify({ tag: el.tagName, id: el.id, cls: el.className,`
    + ` display: cs.display, visibility: cs.visibility, opacity: cs.opacity,`
    + ` pointerEvents: cs.pointerEvents, cursor: cs.cursor,`
    + ` position: cs.position, zIndex: cs.zIndex,`
    + ` overflow: cs.overflow, overflowX: cs.overflowX, overflowY: cs.overflowY,`
    + ` width: cs.width, height: cs.height,`
    + ` rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)},`
    + ` scrollH: el.scrollHeight, offsetH: el.offsetHeight, clientH: el.clientHeight })`
  );
  console.log(pretty(res));
}

async function cmdRect(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const r = el.getBoundingClientRect();`
    + `return JSON.stringify({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height })`
  );
  console.log(pretty(res));
}

async function cmdHit(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const r = el.getBoundingClientRect();`
    + `const cx = r.left + r.width/2, cy = r.top + r.height/2;`
    + `const hit = document.elementFromPoint(cx, cy);`
    + `const cs = hit ? getComputedStyle(hit) : null;`
    + `return JSON.stringify({ `
    + `  x: Math.round(cx), y: Math.round(cy),`
    + `  target: { tag: hit && hit.tagName, cls: hit && hit.className.slice(0,80), isSameElement: hit === el },`
    + `  targetHtml: hit && hit.outerHTML.slice(0,300),`
    + `  targetStyles: cs ? { zIndex: cs.zIndex, position: cs.position, pointerEvents: cs.pointerEvents } : null`
    + `})`
  );
  console.log(pretty(res));
}

async function cmdStack(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const stack = [];`
    + `let cur = el;`
    + `while (cur && cur !== document.documentElement) {`
    + `  const cs = getComputedStyle(cur);`
    + `  const r = cur.getBoundingClientRect();`
    + `  const isCtx = cs.zIndex !== 'auto' || cs.position !== 'static' || parseFloat(cs.opacity) < 1 || cs.transform !== 'none' || cs.filter !== 'none';`
    + `  if (isCtx) stack.push({ tag: cur.tagName, cls: cur.className.slice(0,60), zIndex: cs.zIndex, position: cs.position, opacity: cs.opacity, rect: {t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)} });`
    + `  cur = cur.parentElement;`
    + `}`
    + `return JSON.stringify(stack)`
  );
  console.log(pretty(res));
}

async function cmdClip(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const clips = [];`
    + `let cur = el.parentElement;`
    + `while (cur && cur !== document.body) {`
    + `  const cs = getComputedStyle(cur);`
    + `  const r = cur.getBoundingClientRect();`
    + `  if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {`
    + `    clips.push({ cls: cur.className.slice(0,60), ov: cs.overflow, ovx: cs.overflowX, ovy: cs.overflowY, rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)} });`
    + `  }`
    + `  cur = cur.parentElement;`
    + `}`
    + `return JSON.stringify(clips)`
  );
  console.log(pretty(res));
}

async function cmdPath(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const path = [];`
    + `let cur = el;`
    + `while (cur && path.length < 20) {`
    + `  const r = cur.getBoundingClientRect();`
    + `  const cs = getComputedStyle(cur);`
    + `  path.push({ tag: cur.tagName, cls: cur.className.slice(0,60), rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, zIndex: cs.zIndex, overflow: cs.overflow, pointerEvents: cs.pointerEvents });`
    + `  cur = cur.parentElement;`
    + `}`
    + `return JSON.stringify(path)`
  );
  console.log(pretty(res));
}

async function cmdHtml(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `return el.outerHTML.slice(0, 2000)`
  );
  console.log(pretty(res));
}

async function cmdClick(sel: string) {
  const res = await webClick(sel);
  console.log(pretty(res));
  // Wait a tick and grab any debug logs
  await new Promise(r => setTimeout(r, 300));
  try {
    const logs = await webEval(`return JSON.stringify(window.__debugLogs || [])`);
    const parsed = typeof logs === "string" ? JSON.parse(logs) : logs;
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log("\ncaptured logs after click:", parsed);
    }
  } catch {}
}

async function cmdEval(js: string) {
  let script = js;

  // Read from stdin when arg is "-"
  if (js === "-") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    script = Buffer.concat(chunks).toString("utf8").trim();
  }

  // Auto-wrap bare scripts so top-level var/const/let and `return` work
  const trimmed = script.trim();
  const alreadyReturns =
    trimmed.startsWith("return ") ||
    trimmed.startsWith("(function") ||
    trimmed.startsWith("(() =>");
  const final = alreadyReturns ? script : `return (function() { ${script} })()`;

  const res = await webEval(final);
  console.log(pretty(res));
}

async function cmdStore(name: string, keyPath?: string) {
  // Access Pinia store by name; optionally drill into a dot-separated keyPath.
  const kp = keyPath ? JSON.stringify(keyPath) : JSON.stringify("");
  const script = [
    `const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.['$pinia'];`,
    `if (!pinia) return 'no pinia — app may not have loaded';`,
    `const store = pinia._s.get(${q(name)});`,
    `if (!store) return 'store not found: ${name}. available: ' + Array.from(pinia._s.keys()).join(', ');`,
    `const snap = {};`,
    `for (const k of Object.keys(store)) {`,
    `  if (!k.startsWith('$') && k !== '_p') {`,
    `    try { const v = store[k]; if (typeof v !== 'function') snap[k] = v; } catch {}`,
    `  }`,
    `}`,
    `const kp = ${kp};`,
    `if (kp) { let cur = store; for (const p of kp.split('.')) cur = cur?.[p]; return JSON.stringify(cur); }`,
    `return JSON.stringify(snap);`,
  ].join(" ");
  const res = await webEval(script);
  console.log(pretty(res));
}

async function cmdWaitFor(sel: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`Waiting for '${sel}' (up to ${timeoutMs}ms)...`);
  while (Date.now() < deadline) {
    const count = await webEval(`return document.querySelectorAll(${q(sel)}).length`);
    if (Number(count) > 0) {
      const elapsed = timeoutMs - (deadline - Date.now());
      process.stdout.write(` found after ${elapsed}ms\n`);
      await cmdFind(sel);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  process.stdout.write(` TIMEOUT\n`);
  console.error(`'${sel}' not found after ${timeoutMs}ms`);
  process.exit(1);
}

async function cmdLogs() {
  const res = await webEval(`return JSON.stringify(window.__debugLogs || 'no __debugLogs on window')`);
  console.log(pretty(res));
}

async function cmdButtons() {
  const res = await webEval(
    `return JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => {`
    + `  const r = b.getBoundingClientRect();`
    + `  const cs = getComputedStyle(b);`
    + `  return { cls: b.className.slice(0,60), text: b.textContent && b.textContent.trim().slice(0,30), rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, pe: cs.pointerEvents, vis: cs.visibility, dis: cs.display };`
    + `}))`
  );
  console.log(pretty(res));
}

async function cmdSnapshot() {
  const res = await webEval(`return document.body.innerHTML.slice(0, 3000)`);
  console.log(pretty(res));
}

async function cmdHittest(x: number, y: number) {
  const res = await webEval(
    `const hit = document.elementFromPoint(${x}, ${y});`
    + `if (!hit) return 'nothing at (' + ${x} + ',' + ${y} + ')';`
    + `const cs = getComputedStyle(hit);`
    + `const r = hit.getBoundingClientRect();`
    + `return JSON.stringify({ tag: hit.tagName, cls: hit.className.slice(0,80), html: hit.outerHTML.slice(0,300), rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents })`
  );
  console.log(pretty(res));
}

async function cmdListen(sel: string, event: string) {
  // Attach listener that writes to window.__listenLog
  await webEval(
    `window.__listenLog = window.__listenLog || [];`
    + `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND")};`
    + `el.addEventListener(${q(event)}, function(e) { window.__listenLog.push({ type: e.type, target: e.target && e.target.className, t: Date.now() }); }, true);`
    + `return 'listener attached'`
  );
  console.log(`Listening for '${event}' on '${sel}' for 5 seconds — click the element now...`);
  await new Promise(r => setTimeout(r, 5000));
  const res = await webEval(`return JSON.stringify(window.__listenLog || [])`);
  console.log(pretty(res));
}

async function cmdLayers(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const layers = [];`
    + `let cur = el;`
    + `while (cur && cur !== document.documentElement && layers.length < 20) {`
    + `  const cs = getComputedStyle(cur);`
    + `  const r = cur.getBoundingClientRect();`
    + `  layers.push({ tag: cur.tagName, cls: cur.className.slice(0,50), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents, overflow: cs.overflow, zIndex: cs.zIndex, position: cs.position, rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)} });`
    + `  cur = cur.parentElement;`
    + `}`
    + `return JSON.stringify(layers)`
  );
  console.log(pretty(res));
}

async function cmdVue(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const vueKey = Object.keys(el).find(k => k.startsWith('__vue'));`
    + `if (!vueKey) return 'no Vue instance found on element';`
    + `const vm = el[vueKey];`
    + `try { return JSON.stringify({ type: vm.type && vm.type.__name, props: vm.props, setupState: Object.keys(vm.setupState || {}) }); } catch(e) { return String(e); }`
  );
  console.log(pretty(res));
}

async function cmdScroll(sel: string) {
  const res = await webEval(
    `const el = document.querySelector(${q(sel)});`
    + `if (!el) return ${q("NOT FOUND: " + sel)};`
    + `const r = el.getBoundingClientRect();`
    + `return JSON.stringify({ scrollHeight: el.scrollHeight, offsetHeight: el.offsetHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, offsetWidth: el.offsetWidth, clientWidth: el.clientWidth, rect: {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)} })`
  );
  console.log(pretty(res));
}

async function cmdScreenshot(destPath?: string) {
  const url = new URL(BASE + "/screenshot");
  if (destPath) url.searchParams.set("path", destPath);
  const res = await fetch(url.toString());
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (parsed && typeof parsed === "object" && "__error" in (parsed as Record<string, unknown>)) {
    throw new Error(`Screenshot failed: ${(parsed as { __error: string }).__error}`);
  }
  console.log((parsed as { path: string }).path);
}

async function cmdHunkDiag() {
  // Diagnose hunk-bar alignment: for each visible bar, report its position
  // alongside nearby diff decorations and Monaco scroll info.
  const res = await webEval(`
    var scrollEl = document.querySelector('.monaco-scrollable-element');
    var scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    var inserts = Array.from(document.querySelectorAll('.line-insert'));
    var deleteds = Array.from(document.querySelectorAll('.line-delete'));
    var bars = Array.from(document.querySelectorAll('.hunk-bar'));
    var editorEl = document.querySelector('.monaco-diff-editor');
    var editorTop = editorEl ? Math.round(editorEl.getBoundingClientRect().top) : 0;
    return JSON.stringify({
      scrollTop: Math.round(scrollTop),
      editorTop: editorTop,
      inserts: inserts.map(function(el) {
        var r = el.getBoundingClientRect();
        var p = el.parentElement;
        return { top: Math.round(r.top), bot: Math.round(r.bottom), h: Math.round(r.height), parentCls: p ? p.className.slice(0,60) : 'none', inScrollEl: !!el.closest('.monaco-scrollable-element') };
      }),
      deleteds: deleteds.map(function(el) {
        var r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bot: Math.round(r.bottom), h: Math.round(r.height) };
      }),
      bars: bars.filter(function(b){ return b.getBoundingClientRect().width > 0; }).map(function(b) {
        var r = b.getBoundingClientRect();
        var zone = b.parentElement;
        var vapp = zone && zone.__vue_app__;
        var inst = vapp && vapp._component;
        var hunkHash = inst && inst.props && inst.props.hunk ? inst.props.hunk.hash : 'unknown';
        return { top: Math.round(r.top), h: Math.round(r.height), zoneH: zone ? zone.style.height : '?', inScrollEl: !!b.closest('.monaco-scrollable-element') };
      })
    });
  `);
  console.log(pretty(res));
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

if (!cmd) {
  console.log(`
debug-cli — WebView DOM inspector

Commands:
  find    <selector>           Element count + first match styles
  all     <selector>           All matching elements with rects
  nth     <selector> <n>       Nth match (0-based) styles + HTML
  count   <selector>           Just the element count
  styles  <selector>           Full computed style snapshot
  rect    <selector>           Bounding rect
  hit     <selector>           elementFromPoint at element center
  stack   <selector>           Stacking context chain
  clip    <selector>           Ancestors with overflow != visible
  path    <selector>           Full ancestor path (tag/class/rect/styles)
  html    <selector>           outerHTML
  click   <selector>           Simulate mousedown+mouseup+click
  eval    <js>                 Evaluate JS ('-' to read from stdin)
  logs                         Print window.__debugLogs
  buttons                      All buttons with styles
  snapshot                     Body innerHTML (3000 chars)
  hittest <x> <y>              elementFromPoint at x,y coords
  waitfor <selector> [ms]      Poll until element appears (default: 5000ms)
  listen  <selector> <event>   Listen for event for 5s
  layers  <selector>           All ancestor display/visibility/pointer-events
  vue     <selector>           Vue component props/state
  scroll  <selector>           scrollHeight vs offsetHeight vs clientHeight
  store   <name> [keyPath]     Read Pinia store (e.g. store review selectedFile)
  screenshot [path]            Capture screen to file (default: /tmp/railyn-debug-*.png)
  hunkdiag                     Diagnose hunk-bar alignment vs diff decorations
`);
  process.exit(0);
}

try {
  // Check server is up
  const ping = await fetch(BASE + "/").catch(() => null);
  if (!ping?.ok) {
    console.error("Debug server not reachable at " + BASE + " — is the app running?");
    process.exit(1);
  }

  switch (cmd) {
    case "find":    await cmdFind(args[0]); break;
    case "all":     await cmdAll(args[0]); break;
    case "nth":     await cmdNth(args[0], Number(args[1] ?? 0)); break;
    case "count":   await cmdCount(args[0]); break;
    case "styles":  await cmdStyles(args[0]); break;
    case "rect":    await cmdRect(args[0]); break;
    case "hit":     await cmdHit(args[0]); break;
    case "stack":   await cmdStack(args[0]); break;
    case "clip":    await cmdClip(args[0]); break;
    case "path":    await cmdPath(args[0]); break;
    case "html":    await cmdHtml(args[0]); break;
    case "click":   await cmdClick(args[0]); break;
    case "eval":    await cmdEval(args.join(" ")); break;
    case "logs":    await cmdLogs(); break;
    case "buttons": await cmdButtons(); break;
    case "snapshot":await cmdSnapshot(); break;
    case "hittest": await cmdHittest(Number(args[0]), Number(args[1])); break;
    case "waitfor": await cmdWaitFor(args[0], args[1] ? Number(args[1]) : 5000); break;
    case "listen":  await cmdListen(args[0], args[1]); break;
    case "layers":  await cmdLayers(args[0]); break;
    case "vue":     await cmdVue(args[0]); break;
    case "scroll":  await cmdScroll(args[0]); break;
    case "store":   await cmdStore(args[0], args[1]); break;
    case "screenshot": await cmdScreenshot(args[0]); break;
    case "hunkdiag": await cmdHunkDiag(); break;
    default:
      console.error(`Unknown command: ${cmd}. Run without args for help.`);
      process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
