/**
 * mock-api.ts — Intercept all /api/* calls with page.route().
 *
 * Usage:
 *   const api = new ApiMock(page);
 *   api.handle("boards.list", () => [makeBoard()]);
 *   api.handle("tasks.list", ({ boardId }) => [task]);
 *   await api.install();          // installs all routes
 *
 * After install(), calling api.handle() again for the same method
 * replaces the previous handler and applies immediately (page.unroute + re-route).
 *
 * Every unhandled /api/* call returns a 501 so tests fail loudly on missing stubs.
 */

import type { Page, Route } from "@playwright/test";
import type { RailynAPI } from "@shared/rpc-types";

type AnyHandler = (params: unknown) => unknown | Promise<unknown>;

export class ApiMock {
    private _page: Page;
    private _handlers = new Map<string, AnyHandler>();
    private _installed = false;

    constructor(page: Page) {
        this._page = page;
    }

    /**
     * Register a handler for a specific API method.
     * Can be called before or after install().
     */
    handle<M extends keyof RailynAPI>(
        method: M,
        handler: (params: RailynAPI[M]["params"]) => RailynAPI[M]["response"] | Promise<RailynAPI[M]["response"]>,
    ): this {
        this._handlers.set(method as string, handler as AnyHandler);
        return this;
    }

    /**
     * Register a handler that returns a fixed value (no params needed).
     */
    returns<M extends keyof RailynAPI>(method: M, value: RailynAPI[M]["response"]): this {
        return this.handle(method, () => value);
    }

    /**
     * Install a single page.route() that dispatches all /api/* calls.
     * Safe to call multiple times — unroutes and re-installs.
     */
    async install(): Promise<void> {
        if (this._installed) {
            await this._page.unroute("/api/**");
        }
        await this._page.route("/api/**", async (route: Route) => {
            const url = new URL(route.request().url());
            const method = url.pathname.replace(/^\/api\//, "");

            const handler = this._handlers.get(method);
            if (!handler) {
                console.warn(`[ApiMock] No handler for: ${method}`);
                await route.fulfill({ status: 501, body: `No mock for: ${method}` });
                return;
            }

            let params: unknown = {};
            try {
                const body = route.request().postData();
                if (body) params = JSON.parse(body);
            } catch {
                // ignore parse errors
            }

            try {
                const result = await handler(params);
                if (result === undefined) {
                    // Void/no-return handlers — send empty body without application/json
                    // so the RPC client returns undefined cleanly (no JSON.parse error).
                    await route.fulfill({ status: 200, body: "" });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify(result),
                    });
                }
            } catch (err) {
                await route.fulfill({
                    status: 500,
                    body: String(err),
                });
            }
        });
        this._installed = true;
    }
}
