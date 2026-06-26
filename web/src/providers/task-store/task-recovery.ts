import { useProviderTaskStore } from "./task-store";
import { TaskStatus, type TaskRecoveryIssue, type TaskRecord } from "./types";

const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

export type TaskRecoveryScanInput = {
    readonly projectId: string;
    readonly nodeIds: readonly string[];
    readonly now?: Date;
};

export type TaskRecoveryScanResult = {
    readonly writeBackTasks: TaskRecord[];
    readonly needsResumeTasks: TaskRecord[];
    readonly issues: TaskRecoveryIssue[];
};

export function scanProviderTaskRecovery(input: TaskRecoveryScanInput): TaskRecoveryScanResult {
    const store = useProviderTaskStore.getState();
    const now = input.now ?? new Date();
    const nodeIds = new Set(input.nodeIds);
    const writeBackTasks: TaskRecord[] = [];
    const needsResumeTasks: TaskRecord[] = [];
    const issues: TaskRecoveryIssue[] = [];

    store.listProjectTasks(input.projectId).forEach((task) => {
        if (!nodeIds.has(task.nodeId)) {
            if (!isFinalForMissingNode(task.status)) {
                store.markUnrecoverable(task.pendingId, "节点不存在，跳过恢复");
                issues.push(createIssue(task, "节点不存在，跳过恢复"));
            }
            return;
        }

        if (task.recoveryMode === "unrecoverable") {
            if (task.status !== TaskStatus.Unrecoverable) {
                const reason = task.unrecoverableReason || "任务不支持跨刷新恢复";
                store.markUnrecoverable(task.pendingId, reason);
                issues.push(createIssue(task, reason));
            }
            return;
        }

        if (task.status === TaskStatus.Completed) {
            writeBackTasks.push(task);
            return;
        }

        if (task.status === TaskStatus.Pending && now.getTime() - new Date(task.createdAt).getTime() > PENDING_TIMEOUT_MS) {
            store.markUnrecoverable(task.pendingId, "任务长时间停留在 pending，无法恢复");
            issues.push(createIssue(task, "任务长时间停留在 pending，无法恢复"));
            return;
        }

        if (task.status === TaskStatus.Running && task.responseMode === "sync") {
            store.markUnrecoverable(task.pendingId, "刷新前同步请求未完成，无法恢复");
            issues.push(createIssue(task, "刷新前同步请求未完成，无法恢复"));
            return;
        }

        if (task.status === TaskStatus.Running && task.responseMode === "async-pollable") {
            needsResumeTasks.push(task);
        }
    });

    store.cleanupTasks(now);

    return { writeBackTasks, needsResumeTasks, issues };
}

function isFinalForMissingNode(status: TaskStatus) {
    return [TaskStatus.Written, TaskStatus.Failed, TaskStatus.Cancelled, TaskStatus.Unrecoverable, TaskStatus.Superseded].includes(status);
}

function createIssue(task: TaskRecord, reason: string): TaskRecoveryIssue {
    return {
        taskId: task.pendingId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        status: task.status,
        reason,
    };
}