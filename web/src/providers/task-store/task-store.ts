import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { GenerateRequest, GenerateResult, JsonObject, JsonValue, ProviderResponseMode } from "../core/types";
import { publishTaskUpdate } from "./broadcast";
import { TaskStatus, type ProviderTaskContext, type ProviderTaskUpdate, type TaskErrorSnapshot, type TaskRecord, type TaskRequestSnapshot } from "./types";

const TASK_STORE_KEY = "infinite-canvas:provider_task_store";
const MAX_SAFE_STRING_LENGTH = 1200;
const SENSITIVE_KEYS = new Set(["apikey", "api_key", "authorization", "auth", "token", "secret", "password"]);

export type CreateTaskInput = {
    readonly pendingId: string;
    readonly providerId: string;
    readonly responseMode: ProviderResponseMode;
    readonly request: GenerateRequest;
    readonly taskContext: ProviderTaskContext;
};

type ProviderTaskStore = {
    hydrated: boolean;
    tasks: Record<string, TaskRecord>;
    createTask: (input: CreateTaskInput) => TaskRecord;
    markRunning: (pendingId: string, patch?: ProviderTaskUpdate) => void;
    updateTask: (pendingId: string, patch: ProviderTaskUpdate) => void;
    completeTask: (pendingId: string, result: GenerateResult) => void;
    failTask: (pendingId: string, error: TaskErrorSnapshot) => void;
    cancelTask: (pendingId: string, message?: string) => void;
    markWritten: (pendingId: string) => void;
    markUnrecoverable: (pendingId: string, reason: string) => void;
    supersedeNodeTasks: (projectId: string, nodeId: string, exceptPendingId?: string) => void;
    clearNodeTasks: (projectId: string, nodeId: string) => void;
    cleanupTasks: (now?: Date) => void;
    getTask: (pendingId: string) => TaskRecord | undefined;
    listProjectTasks: (projectId: string) => TaskRecord[];
    resetTasks: () => void;
};

type PersistedTaskState = Pick<ProviderTaskStore, "tasks">;

const taskStorage: PersistStorage<ProviderTaskStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        return JSON.parse(value) as StorageValue<ProviderTaskStore>;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useProviderTaskStore = create<ProviderTaskStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            tasks: {},
            createTask: (input) => {
                const now = new Date().toISOString();
                const recoverable = input.taskContext.recoverable !== false;
                const record: TaskRecord = {
                    pendingId: input.pendingId,
                    providerId: input.providerId,
                    projectId: input.taskContext.projectId,
                    nodeId: input.taskContext.nodeId,
                    capability: input.request.capability,
                    modelId: input.request.modelId,
                    responseMode: input.responseMode,
                    status: recoverable ? TaskStatus.Pending : TaskStatus.Unrecoverable,
                    recoveryMode: recoverable ? "recoverable" : "unrecoverable",
                    createdAt: now,
                    updatedAt: now,
                    request: createRequestSnapshot(input.request, input.taskContext),
                    unrecoverableReason: input.taskContext.unrecoverableReason,
                };
                set((state) => ({ tasks: { ...state.tasks, [record.pendingId]: record } }));
                notify(record);
                return record;
            },
            markRunning: (pendingId, patch) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                ...compactTaskPatch(patch),
                status: TaskStatus.Running,
                startedAt: record.startedAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })),
            updateTask: (pendingId, patch) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                ...compactTaskPatch(patch),
                status: normalizeTaskStatus(patch.status) ?? record.status,
                updatedAt: new Date().toISOString(),
            })),
            completeTask: (pendingId, result) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                status: TaskStatus.Completed,
                result: sanitizeResult(result),
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })),
            failTask: (pendingId, error) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                status: error.code === "canceled" ? TaskStatus.Cancelled : TaskStatus.Failed,
                error: sanitizeError(error),
                updatedAt: new Date().toISOString(),
            })),
            cancelTask: (pendingId, message = "任务已取消") => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                status: TaskStatus.Cancelled,
                error: { code: "canceled", message },
                updatedAt: new Date().toISOString(),
            })),
            markWritten: (pendingId) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                status: TaskStatus.Written,
                writtenAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            })),
            markUnrecoverable: (pendingId, reason) => updateRecord(set, get, pendingId, (record) => ({
                ...record,
                status: TaskStatus.Unrecoverable,
                recoveryMode: "unrecoverable",
                unrecoverableReason: reason,
                updatedAt: new Date().toISOString(),
            })),
            supersedeNodeTasks: (projectId, nodeId, exceptPendingId) => {
                const now = new Date().toISOString();
                const nextTasks = { ...get().tasks };
                Object.values(nextTasks).forEach((record) => {
                    if (record.projectId !== projectId || record.nodeId !== nodeId || record.pendingId === exceptPendingId || isTerminal(record.status)) return;
                    const next = { ...record, status: TaskStatus.Superseded, updatedAt: now };
                    nextTasks[record.pendingId] = next;
                    notify(next);
                });
                set({ tasks: nextTasks });
            },
            clearNodeTasks: (projectId, nodeId) => {
                const now = new Date().toISOString();
                const nextTasks = { ...get().tasks };
                Object.values(nextTasks).forEach((record) => {
                    if (record.projectId !== projectId || record.nodeId !== nodeId) return;
                    const status = [TaskStatus.Pending, TaskStatus.Running].includes(record.status) ? TaskStatus.Cancelled : TaskStatus.Superseded;
                    const next = { ...record, status, updatedAt: now };
                    nextTasks[record.pendingId] = next;
                    notify(next);
                });
                set({ tasks: nextTasks });
            },
            cleanupTasks: (now = new Date()) => {
                const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
                const tasks = Object.fromEntries(
                    Object.entries(get().tasks).filter(([, record]) => {
                        if (record.status === TaskStatus.Superseded) return false;
                        if (![TaskStatus.Written, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Unrecoverable].includes(record.status)) return true;
                        return new Date(record.updatedAt).getTime() >= cutoff;
                    }),
                );
                set({ tasks });
            },
            getTask: (pendingId) => get().tasks[pendingId],
            listProjectTasks: (projectId) => Object.values(get().tasks).filter((record) => record.projectId === projectId),
            resetTasks: () => set({ tasks: {} }),
        }),
        {
            name: TASK_STORE_KEY,
            storage: taskStorage,
            partialize: (state) => ({ tasks: state.tasks }) as StorageValue<ProviderTaskStore>["state"],
            onRehydrateStorage: () => () => {
                useProviderTaskStore.setState({ hydrated: true });
            },
        },
    ),
);

function updateRecord(
    set: (partial: Partial<ProviderTaskStore> | ((state: ProviderTaskStore) => Partial<ProviderTaskStore>)) => void,
    get: () => ProviderTaskStore,
    pendingId: string,
    reducer: (record: TaskRecord) => TaskRecord,
) {
    const record = get().tasks[pendingId];
    if (!record) return;
    const next = reducer(record);
    set((state) => ({ tasks: { ...state.tasks, [pendingId]: next } }));
    notify(next);
}

function createRequestSnapshot(request: GenerateRequest, context: ProviderTaskContext): TaskRequestSnapshot {
    return {
        capability: request.capability,
        modelId: request.modelId,
        params: sanitizeJsonObject(request.params),
        metadata: request.metadata ? sanitizeJsonObject(request.metadata) : undefined,
        referenceImageIds: context.referenceImageIds,
    };
}

function compactTaskPatch(patch?: ProviderTaskUpdate): Partial<TaskRecord> {
    if (!patch) return {};
    return {
        runtimeTaskId: patch.runtimeTaskId,
        progress: patch.progress,
        message: patch.message,
        metadata: patch.metadata ? sanitizeJsonObject(patch.metadata) : undefined,
    };
}

function sanitizeResult(result: GenerateResult): GenerateResult {
    return {
        ...result,
        outputs: result.outputs.map((output) => {
            if (output.type === "image") return { ...output, dataUrl: sanitizeString(output.dataUrl) };
            if (output.type === "video") return { type: output.type, url: output.url, mimeType: output.mimeType, metadata: output.metadata };
            if (output.type === "audio") return { type: output.type, url: output.url, mimeType: output.mimeType, metadata: output.metadata };
            return output;
        }),
        raw: undefined,
    };
}

function sanitizeError(error: TaskErrorSnapshot): TaskErrorSnapshot {
    return {
        code: error.code,
        message: sanitizeString(error.message) ?? "Provider task failed",
        details: error.details ? sanitizeJsonObject(error.details) : undefined,
    };
}

function sanitizeJsonObject(value: JsonObject): JsonObject {
    return sanitizeJsonValue(value) as JsonObject;
}

function sanitizeJsonValue(value: unknown): JsonValue {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return sanitizeString(value) ?? "[removed]";
    if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item));
    if (typeof value === "object") {
        const tag = Object.prototype.toString.call(value);
        if (tag === "[object Blob]" || tag === "[object File]") return "[removed]";
        const output: Record<string, JsonValue> = {};
        Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
            if (SENSITIVE_KEYS.has(entryKey.toLowerCase())) return;
            output[entryKey] = sanitizeJsonValue(entryValue);
        });
        return output;
    }
    return "[removed]";
}

function sanitizeString(value: string | undefined): string | undefined {
    if (!value) return value;
    if (value.startsWith("data:")) return "[data-url-removed]";
    if (value.length > MAX_SAFE_STRING_LENGTH) return `${value.slice(0, MAX_SAFE_STRING_LENGTH)}...`;
    return value;
}

function normalizeTaskStatus(status: ProviderTaskUpdate["status"]): TaskStatus | undefined {
    if (status === "running") return TaskStatus.Running;
    if (status === "completed") return TaskStatus.Completed;
    if (status === "failed") return TaskStatus.Failed;
    return undefined;
}

function isTerminal(status: TaskStatus) {
    return [TaskStatus.Completed, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Written, TaskStatus.Unrecoverable, TaskStatus.Superseded].includes(status);
}

function notify(record: TaskRecord) {
    publishTaskUpdate({
        taskId: record.pendingId,
        status: record.status,
    });
}