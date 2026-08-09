import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// NOTE: this module is imported by scripts/postinstall.ts. Never call
// process.exit() here — it would terminate the postinstall process before
// downstream steps (e.g. code-server's own postinstall) run.

const root = import.meta.dir;
const pkgPath = join(root, "../node_modules/eventsource/package.json");

export function patchEventsource(): void {
  if (!existsSync(pkgPath)) {
    console.warn("[postinstall] eventsource not installed — skipping patch");
    return;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  if (pkg.version !== "3.0.7") {
    console.warn(`[postinstall] eventsource@${pkg.version} — patch target is 3.0.7, skipping`);
    return;
  }

  const fixed = {
    ".": {
      import: "./dist/index.cjs",
      require: "./dist/index.cjs",
      default: "./dist/index.cjs",
    },
    "./package.json": "./package.json",
  };

  if (JSON.stringify(pkg.exports) === JSON.stringify(fixed)) {
    console.log("[postinstall] eventsource exports already patched — skipping");
    return;
  }

  pkg.exports = fixed;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("[postinstall] patched eventsource exports -> CJS build (bun dual-package fix)");
}

patchEventsource();
