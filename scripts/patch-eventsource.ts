import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const root = import.meta.dir;
const pkgPath = join(root, "../node_modules/eventsource/package.json");

if (!existsSync(pkgPath)) {
  console.warn("[postinstall] eventsource not installed — skipping patch");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

if (pkg.version !== "3.0.7") {
  console.warn(`[postinstall] eventsource@${pkg.version} — patch target is 3.0.7, skipping`);
  process.exit(0);
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
  process.exit(0);
}

pkg.exports = fixed;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("[postinstall] patched eventsource exports -> CJS build (bun dual-package fix)");
