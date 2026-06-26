import type { GenerateResult, JsonObject, ProviderCapability, ProviderResponseMode, ProviderTaskContext, ProviderTaskUpdate } from "../core/types";

export type { ProviderTaskContext, ProviderTaskUpdate } from "../core/types";

export enum TaskStatus {
    Pending = "pending",
    Running = "running",
    Completed = "completed",
    Failed = "failed",
    Cancelled = "cancelled",
    Written = "written",
    Unrecoverable = "unrecoverable",
    Superseded = "superseded",
}

export type TaskRecoveryMode = "recoverable" | "unrecoverable" | "needs_resume";

export type TaskRequestSnapshot = {
    readonly capability: ProviderCapability;
    readonly modelId: string;
    readonly params: JsonObject;
    readonly metadata?: JsonObject;
    readonly referenceImageIds?: readonly string[];
};

export type TaskErrorSnapshot = {
    readonly code?: string;
    readonly message: string;
    readonly details?: JsonObject;
};

export type TaskRecoveryIssue = {
    readonly taskId: string;
    readonly projectId: string;
    readonly nodeId: string;
    readonly status: TaskStatus;
    readonly reason: string;
};

export type TaskRecord = {
    readonly pendingId: string;
    readonly providerId: string;
    readonly projectId: string;
    readonly nodeId: string;
    readonly capability: ProviderCapability;
    readonly modelId: string;
    readonly responseMode: ProviderResponseMode;
    readonly status: TaskStatus;
    readonly recoveryMode: TaskRecoveryMode;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly writtenAt?: string;
    readonly runtimeTaskId?: string;
    readonly progress?: number;
    readonly message?: string;
    readonly request: TaskRequestSnapshot;
    readonly result?: GenerateResult;
    readonly error?: TaskErrorSnapshot;
    readonly metadata?: JsonObject;
    readonly unrecoverableReason?: string;
};

export type TaskBroadcastPayload = {
    readonly taskId: string;
    readonly status: TaskStatus;
};