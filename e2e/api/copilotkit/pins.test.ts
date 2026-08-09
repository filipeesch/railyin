/**
 * pins.test.ts — HOST-03 pin evidence for the CopilotRuntime stack.
 *
 * Pure unit test (no server, no startServer): reads package.json from the
 * repo root and asserts the five exact pin strings and @copilotkit/vue's
 * dependency section. This guards against future casual bump drift —
 * a `bun add pkg@^x` or hand-edit that moves any pin fails loudly here.
 *
 * Pins (locked decisions D-09/D-10):
 *   - @copilotkit/runtime@1.66.4
 *   - @copilotkit/vue@1.66.4     (regular dependency, pinned but unconsumed this phase)
 *   - @ag-ui/core@0.0.57
 *   - @ag-ui/client@0.0.57
 *   - @ag-ui/encoder@0.0.57
 *   - rxjs@^7.8.2                 (explicit direct pin — 02-03; hoisted 7.8.2,
 *                                 nested 7.8.1 inside @ag-ui/client; the explicit
 *                                 pin prevents dedupe surprises, research Installation)
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf-8"),
) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
};

describe("copilotkit stack pins (HOST-03)", () => {
    test("all five packages are pinned with exact versions in dependencies", () => {
        expect(pkg.dependencies["@copilotkit/runtime"]).toBe("1.66.4");
        expect(pkg.dependencies["@copilotkit/vue"]).toBe("1.66.4");
        expect(pkg.dependencies["@ag-ui/core"]).toBe("0.0.57");
        expect(pkg.dependencies["@ag-ui/client"]).toBe("0.0.57");
        expect(pkg.dependencies["@ag-ui/encoder"]).toBe("0.0.57");
    });

    test("@copilotkit/vue is a regular dependency, not a devDependency (D-10)", () => {
        expect(pkg.devDependencies["@copilotkit/vue"]).toBeUndefined();
    });

    test("@ag-ui/* pins are exact — no caret ranges in dependencies", () => {
        // The five pins above are asserted exactly; additionally verify the
        // AG-UI entries carry no range specifier of any kind.
        for (const name of ["@ag-ui/core", "@ag-ui/client", "@ag-ui/encoder"]) {
            expect(pkg.dependencies[name]).toMatch(/^0\.0\.57$/);
        }
    });

    test("rxjs is an explicit direct dependency pinned to ^7.8.2 (02-03, HOST-03 continuation)", () => {
        // The agent/runner import from "rxjs"; hoisted at 7.8.2 with a nested
        // 7.8.1 in @ag-ui/client. The explicit pin prevents dedupe surprises.
        expect(pkg.dependencies["rxjs"]).toBe("^7.8.2");
    });
});
