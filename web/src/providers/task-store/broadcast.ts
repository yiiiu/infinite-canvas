import type { TaskBroadcastPayload } from "./types";

const CHANNEL_NAME = "infinite-canvas:provider-tasks";
let channel: BroadcastChannel | null = null;

export function publishTaskUpdate(payload: TaskBroadcastPayload) {
    const nextChannel = getChannel();
    if (!nextChannel) return;
    nextChannel.postMessage(payload);
}

export function subscribeTaskUpdates(handler: (payload: TaskBroadcastPayload) => void): () => void {
    const nextChannel = getChannel();
    if (!nextChannel) return () => undefined;

    const listener = (event: MessageEvent) => {
        if (!isTaskBroadcastPayload(event.data)) return;
        handler(event.data);
    };

    nextChannel.addEventListener("message", listener);
    return () => nextChannel.removeEventListener("message", listener);
}

function getChannel() {
    if (typeof BroadcastChannel === "undefined") return null;
    channel ??= new BroadcastChannel(CHANNEL_NAME);
    return channel;
}

export function isTaskBroadcastPayload(value: unknown): value is TaskBroadcastPayload {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    return typeof item.taskId === "string" && typeof item.status === "string" && Object.keys(item).length === 2;
}