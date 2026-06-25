import { ProviderError, ProviderErrorCode, type JsonObject } from "../core/types";

export function normalizeGrsaiError(status: number | undefined, payload: unknown, fallbackMessage: string) {
    const message = errorMessage(payload) || fallbackMessage;
    const code = errorCode(status, message);
    return new ProviderError(code, message, { details: errorDetails(status, payload) });
}

function errorCode(status: number | undefined, message: string) {
    const lowerMessage = message.toLowerCase();
    if (status === 401 || status === 403) return ProviderErrorCode.Unauthorized;
    if (status === 429 || lowerMessage.includes("rate") || lowerMessage.includes("频率") || lowerMessage.includes("太频繁")) return ProviderErrorCode.RateLimited;
    if (status === 402 || lowerMessage.includes("balance") || lowerMessage.includes("credit") || lowerMessage.includes("quota") || lowerMessage.includes("余额")) return ProviderErrorCode.InsufficientBalance;
    if (status === 400 || status === 422) return ProviderErrorCode.InvalidRequest;
    return ProviderErrorCode.AdapterError;
}

function errorMessage(payload: unknown) {
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (!isRecord(payload)) return undefined;
    if (typeof payload.msg === "string" && payload.msg.trim()) return payload.msg.trim();
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
    if (isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) return payload.error.message.trim();
    if (typeof payload.status === "string" && payload.status.trim() && payload.status.toLowerCase() !== "succeeded") return `GrsAI 状态异常：${payload.status}`;
    if (typeof payload.id === "string" && payload.id.trim()) return `GrsAI 任务失败：${payload.id}`;
    return undefined;
}

function errorDetails(status: number | undefined, payload: unknown): JsonObject {
    const details: Record<string, unknown> = {};
    if (status !== undefined) details.status = status;
    if (isJsonObject(payload)) details.payload = payload;
    else if (typeof payload === "string") details.payload = payload;
    return details as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
    if (!isRecord(value)) return false;
    return Object.values(value).every((item) => item === null || ["string", "number", "boolean"].includes(typeof item) || Array.isArray(item) || isJsonObject(item));
}