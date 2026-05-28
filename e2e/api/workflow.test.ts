/**
 * workflow.test.ts — API smoke tests for the workflow RPC methods
 * (workflow.list / workflow.create / workflow.delete) against a real server.
 *
 * The test server's bundled source contains only `default`, so `default` is a
 * bundled (non-deletable) workflow while any created workflow is user-created.
 * Each test runs its own server so accumulated state does not leak.
 */

import { describe, test, expect } from "bun:test";
import { startServer } from "./fixtures/server";

describe("workflow.list / workflow.create (task 5.1)", () => {
    test("list returns the seeded default workflow and reflects newly created workflows", async () => {
        const server = await startServer();
        try {
            const initial = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(initial.length).toBe(1);

            const seeded = initial.find((wf) => wf.id === "default");
            expect(seeded?.name).toBe("Default");
            expect(seeded?.boardCount).toBe(0);
            // The bundled `default` workflow can never be deleted.
            expect(seeded?.deletable).toBe(false);
            expect(seeded?.undeletableReason).toMatch(/bundled/i);

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
            expect(newWorkflow?.name).toBe("My Custom Flow");
            expect(newWorkflow?.boardCount).toBe(0);
            // A user-created workflow with no boards is deletable.
            expect(newWorkflow?.deletable).toBe(true);
            expect(newWorkflow?.undeletableReason).toBeNull();

            // The bundled default stays non-deletable regardless of other workflows.
            const defaultAfter = afterCreate.find((wf) => wf.id === "default");
            expect(defaultAfter?.deletable).toBe(false);
        } finally {
            await server.shutdown();
        }
    }, 30_000);
});

describe("workflow.delete (task 5.2)", () => {
    test("deletes a user-created workflow", async () => {
        const server = await startServer();
        try {
            const { id } = await server.request("workflow.create", {
                workspaceKey: "test-ws",
                name: "Temp Flow",
            });

            await server.request("workflow.delete", { workspaceKey: "test-ws", templateId: id });

            const after = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(after.some((wf) => wf.id === id)).toBe(false);
        } finally {
            await server.shutdown();
        }
    }, 30_000);

    test("rejects deleting the bundled default workflow", async () => {
        const server = await startServer();
        try {
            // request() throws on HTTP error — the server must reject the delete.
            await expect(
                server.request("workflow.delete", { workspaceKey: "test-ws", templateId: "default" }),
            ).rejects.toThrow();

            const after = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(after.some((wf) => wf.id === "default")).toBe(true);
        } finally {
            await server.shutdown();
        }
    }, 30_000);

    test("rejects deleting a workflow referenced by a board", async () => {
        const server = await startServer();
        try {
            const { id } = await server.request("workflow.create", {
                workspaceKey: "test-ws",
                name: "Referenced Flow",
            });

            await server.request("boards.create", {
                workspaceKey: "test-ws",
                name: "Board On Referenced",
                projectKeys: [],
                workflowTemplateId: id,
            });

            const list = await server.request("workflow.list", { workspaceKey: "test-ws" });
            const referenced = list.find((wf) => wf.id === id);
            expect(referenced?.boardCount).toBe(1);
            expect(referenced?.deletable).toBe(false);
            expect(referenced?.undeletableReason).toMatch(/board/i);

            await expect(
                server.request("workflow.delete", { workspaceKey: "test-ws", templateId: id }),
            ).rejects.toThrow();

            const after = await server.request("workflow.list", { workspaceKey: "test-ws" });
            expect(after.some((wf) => wf.id === id)).toBe(true);
        } finally {
            await server.shutdown();
        }
    }, 30_000);
});
