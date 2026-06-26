import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { GenerateRequest } from "../../core/types";
import { isTaskBroadcastPayload } from "../broadcast";
import { scanProviderTaskRecovery } from "../task-recovery";
import { useProviderTaskStore } from "../task-store";
import { TaskStatus } from "../types";

const request: GenerateRequest = {
    capability: "image",
    modelId: "mock-image",
    params: {
        prompt: "hello",
        apiKey: "secret-key",
        referenceImages: [{ url: "data:image/png;base64,aaaa" }],
    },
    signal: undefined,
};

beforeEach(() => {
    useProviderTaskStore.getState().resetTasks();
});

test("creates task records and sanitizes request snapshots", () => {
    const record = createTask("task-1");

    assert.equal(record.status, TaskStatus.Pending);
    assert.equal(record.projectId, "project-1");
    assert.equal(record.nodeId, "node-1");
    assert.equal(record.request.params.apiKey, undefined);
    assert.deepEqual(record.request.params.referenceImages, [{ url: "[data-url-removed]" }]);
});

test("tracks running, completed and written states", () => {
    createTask("task-1");

    useProviderTaskStore.getState().markRunning("task-1", { runtimeTaskId: "remote-1", progress: 0.5 });
    assert.equal(useProviderTaskStore.getState().getTask("task-1")?.status, TaskStatus.Running);
    assert.equal(useProviderTaskStore.getState().getTask("task-1")?.runtimeTaskId, "remote-1");

    useProviderTaskStore.getState().completeTask("task-1", {
        providerId: "mock",
        capability: "image",
        modelId: "mock-image",
        outputs: [{ type: "image", dataUrl: "data:image/png;base64,bbbb" }],
        raw: { large: true },
    });
    const completed = useProviderTaskStore.getState().getTask("task-1");
    assert.equal(completed?.status, TaskStatus.Completed);
    assert.equal(completed?.result?.raw, undefined);
    assert.equal(completed?.result?.outputs[0]?.type, "image");

    useProviderTaskStore.getState().markWritten("task-1");
    assert.equal(useProviderTaskStore.getState().getTask("task-1")?.status, TaskStatus.Written);
});

test("marks node tasks as cancelled or superseded when clearing a deleted node", () => {
    createTask("running-task");
    useProviderTaskStore.getState().markRunning("running-task");
    createTask("completed-task");
    useProviderTaskStore.getState().completeTask("completed-task", { providerId: "mock", capability: "image", modelId: "mock-image", outputs: [] });

    useProviderTaskStore.getState().clearNodeTasks("project-1", "node-1");

    assert.equal(useProviderTaskStore.getState().getTask("running-task")?.status, TaskStatus.Cancelled);
    assert.equal(useProviderTaskStore.getState().getTask("completed-task")?.status, TaskStatus.Superseded);
});

test("cleans superseded tasks and old terminal tasks", () => {
    createTask("task-1");
    useProviderTaskStore.getState().clearNodeTasks("project-1", "node-1");
    createTask("task-2");
    useProviderTaskStore.getState().failTask("task-2", { message: "failed" });

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    useProviderTaskStore.setState((state) => ({
        tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task, updatedAt: old }])),
    }));

    useProviderTaskStore.getState().cleanupTasks(new Date());

    assert.equal(useProviderTaskStore.getState().getTask("task-1"), undefined);
    assert.equal(useProviderTaskStore.getState().getTask("task-2"), undefined);
});

test("classifies recovery scan results", () => {
    createTask("completed-task", "node-1");
    useProviderTaskStore.getState().completeTask("completed-task", { providerId: "mock", capability: "image", modelId: "mock-image", outputs: [{ type: "image", url: "https://example.test/image.png" }] });
    createTask("running-sync", "node-2");
    useProviderTaskStore.getState().markRunning("running-sync");
    createTask("stale-pending", "node-3");
    useProviderTaskStore.setState((state) => ({
        tasks: {
            ...state.tasks,
            "stale-pending": { ...state.tasks["stale-pending"], createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
        },
    }));

    const result = scanProviderTaskRecovery({ projectId: "project-1", nodeIds: ["node-1", "node-2", "node-3"], now: new Date() });

    assert.deepEqual(result.writeBackTasks.map((task) => task.pendingId), ["completed-task"]);
    assert.equal(useProviderTaskStore.getState().getTask("running-sync")?.status, TaskStatus.Unrecoverable);
    assert.equal(useProviderTaskStore.getState().getTask("stale-pending")?.status, TaskStatus.Unrecoverable);
});

test("accepts only minimal broadcast payloads", () => {
    assert.equal(isTaskBroadcastPayload({ taskId: "task-1", status: TaskStatus.Running }), true);
    assert.equal(isTaskBroadcastPayload({ taskId: "task-1", status: TaskStatus.Running, projectId: "project-1" }), false);
    assert.equal(isTaskBroadcastPayload({ pendingId: "task-1", status: TaskStatus.Running }), false);
});

test("skips unrecoverable tasks during recovery scan", () => {
    createTask("unrecoverable-task", "node-1", false);
    useProviderTaskStore.getState().completeTask("unrecoverable-task", { providerId: "mock", capability: "image", modelId: "mock-image", outputs: [{ type: "image", url: "https://example.test/image.png" }] });

    const result = scanProviderTaskRecovery({ projectId: "project-1", nodeIds: ["node-1"], now: new Date() });

    assert.deepEqual(result.writeBackTasks, []);
    assert.equal(useProviderTaskStore.getState().getTask("unrecoverable-task")?.status, TaskStatus.Unrecoverable);
});

function createTask(pendingId: string, nodeId = "node-1", recoverable = true) {
    return useProviderTaskStore.getState().createTask({
        pendingId,
        providerId: "mock",
        responseMode: "sync",
        request,
        taskContext: {
            projectId: "project-1",
            nodeId,
            referenceImageIds: ["stable-reference"],
            recoverable,
            unrecoverableReason: recoverable ? undefined : "参考图没有稳定 storageKey，无法跨刷新恢复",
        },
    });
}