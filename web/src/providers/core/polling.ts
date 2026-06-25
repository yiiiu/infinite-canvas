import { ProviderError, ProviderErrorCode } from "./types";

export type PollUntilProgress<T> = {
    readonly attempt: number;
    readonly elapsedMs: number;
    readonly value: T;
};

export type PollUntilOptions<T> = {
    readonly poll: (attempt: number, signal: AbortSignal | undefined) => Promise<T>;
    readonly until: (value: T) => boolean;
    readonly intervalMs?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: PollUntilProgress<T>) => void;
};

const DEFAULT_INTERVAL_MS = 2500;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function pollUntil<T>({ poll, until, intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onProgress }: PollUntilOptions<T>): Promise<T> {
    const startedAt = Date.now();
    let attempt = 0;

    while (true) {
        throwIfCanceled(signal);
        const value = await poll(attempt, signal);
        const elapsedMs = Date.now() - startedAt;
        onProgress?.({ attempt, elapsedMs, value });
        if (until(value)) return value;
        if (elapsedMs >= timeoutMs) {
            throw new ProviderError(ProviderErrorCode.Timeout, "Provider 轮询超时", { details: { attempt, elapsedMs } });
        }
        attempt += 1;
        await delay(Math.max(0, intervalMs), signal);
    }
}

function delay(ms: number, signal: AbortSignal | undefined) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(canceledError());
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(canceledError());
            },
            { once: true },
        );
    });
}

function throwIfCanceled(signal: AbortSignal | undefined) {
    if (signal?.aborted) throw canceledError();
}

function canceledError() {
    return new ProviderError(ProviderErrorCode.Canceled, "Provider 请求已取消");
}