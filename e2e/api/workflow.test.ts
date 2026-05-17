/**
 * workflow.test.ts — API smoke tests for the workflow RPC methods
 * (workflow.list / workflow.create / workflow.delete).
 *
 * Each describe block manages its own server lifecycle so accumulated state
 * (created workflows, boards) does not leak between scenarios. In particular,
 * the "last remaining workflow" guard needs a pristine server with only the
 * seeded `default` workflow.
 */

import { describe, test, expect } from "bun:test";
import { startServer } from "./fixtures/server";

describe("workflow.list / workflow.create (task 5.1)", () => {
    test("list returns the seeded default workflow and reflects newly created workflows", async () => {
        const server = await startServer();
        try {
            // A fresh server has exactly the seeded `default` workflow.
            const initial = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(Array.isArray(initial)).toBe(true);
            expect(initial.length).toBe(1);

            const seeded = initial.find((wf) => wf.id === "default");
            expect(seeded).toBeDefined();
            expect(seeded?.name).toBe("Default");
            expect(seeded?.boardCount).toBe(0);
            // The only workflow cannot be deleted.
            expect(seeded?.deletable).toBe(false);
            expect(seeded?.undeletableReason).toBe("The last workflow cannot be deleted");

            // Create a new workflow — the name is slugified into an id.
            const created = await server.request("workflow.create", {
                workspaceKey: "test-ws",
                name: "My Custom Flow",
            });
            expect(created.id).toBe("my-custom-flow");

            // workflow.list now reflects the newly created workflow.
            const afterCreate = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(afterCreate.length).toBe(2);

            const newWorkflow = afterCreate.find((wf) => wf.id === "my-custom-flow");
            expect(newWorkflow).toBeDefined();
            expect(newWorkflow?.name).toBe("My Custom Flow");
            expect(newWorkflow?.boardCount).toBe(0);
            // With 2 workflows and no boards referencing it, it is deletable.
            expect(newWorkflow?.deletable).toBe(true);
            expect(newWorkflow?.undeletableReason).toBeNull();

            // The previously-undeletable default is now deletable (2 workflows exist).
            const defaultAfter = afterCreate.find((wf) => wf.id === "default");
            expect(defaultAfter?.deletable).toBe(true);
            expect(defaultAfter?.undeletableReason).toBeNull();
        } finally {
            await server.shutdown();
        }
    }, 30_000);
});

describe("workflow.delete guards (task 5.2)", () => {
    test("delete is rejected when a board references the workflow", async () => {
        const server = await startServer();
        try {
            // Create a second workflow so the rejection is distinctly attributable
            // to the board reference, not the last-workflow guard.
            await server.request("workflow.create", {
                workspaceKey: "test-ws",
                name: "Secondary Flow",
            });

            // Create a board referencing the `default` workflow.
            await server.request("boards.create", {
                workspaceKey: "test-ws",
                name: "Board On Default",
                projectKeys: [],
                workflowTemplateId: "default",
            });

            // workflow.list should now report default as referenced and undeletable.
            const list = await server.request("workflow.list", { workspaceKey: "test-ws" });
            const defaultWf = list.find((wf) => wf.id === "default");
            expect(defaultWf?.boardCount).toBe(1);
            expect(defaultWf?.deletable).toBe(false);
            expect(defaultWf?.undeletableReason).toBe("In use by 1 board");

            // The server must reject the delete — request() throws on HTTP error.
            await expect(
                server.request("workflow.delete", {
                    workspaceKey: "test-ws",
                    templateId: "default",
                }),
            ).rejects.toThrow();

            // The workflow must still exist after the rejected delete.
            const afterReject = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(afterReject.some((wf) => wf.id === "default")).toBe(true);
        } finally {
            await server.shutdown();
        }
    }, 30_000);

    test("delete is rejected for the last remaining workflow", async () => {
        // A pristine server has exactly the seeded `default` workflow.
        const server = await startServer();
        try {
            const list = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(list.length).toBe(1);
            expect(list[0].id).toBe("default");

            // Deleting the only remaining workflow must be rejected.
            await expect(
                server.request("workflow.delete", {
                    workspaceKey: "test-ws",
                    templateId: "default",
                }),
            ).rejects.toThrow();

            // The workflow must still exist.
            const afterReject = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(afterReject.length).toBe(1);
            expect(afterReject[0].id).toBe("default");
        } finally {
            await server.shutdown();
        }
    }, 30_000);
});
