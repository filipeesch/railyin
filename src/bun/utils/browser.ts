// ─── System default browser launcher ───────────────────────────────────────────
//
// Thin wrapper around the `open` npm package. Kept as a tiny, injectable
// collaborator (`BrowserOpener`) so `McpClientRegistry.authorize()` can be
// unit-tested with a fake opener instead of ever launching a real browser.

import open from "open";
import type { BrowserOpener } from "../oauth/types.ts";

export async function openInBrowser(url: string): Promise<void> {
  await open(url);
}

/** Real, `open`-package-backed implementation of `BrowserOpener`. */
export const systemBrowserOpener: BrowserOpener = {
  open: openInBrowser,
};
