import axios from "axios";

import { ProviderError, ProviderErrorCode } from "./types";

export type NormalizedProviderError = {
    readonly code: string;
    readonly message: string;
    readonly raw: unknown;
};

export function normalizeProviderError(error: unknown, fallback = "请求失败"): NormalizedProviderError {
    if (error instanceof ProviderError) {
        return { code: normalizeProviderErrorCode(error.code), message: normalizeProviderErrorMessage(error, fallback), raw: error };
    }
    if (axios.isCancel(error) || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")) {
        return { code: "canceled", message: "请求已取消", raw: error };
    }
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return {
            code: responseData?.code ? String(responseData.code) : error.response?.status ? String(error.response.status) : "network_error",
            message: responseData?.msg || responseData?.error?.message || responseData?.message || statusMessage(error.response?.status, fallback),
            raw: error,
        };
    }
    if (error instanceof Error) return { code: "error", message: error.message || fallback, raw: error };
    return { code: "unknown", message: fallback, raw: error };
}

function normalizeProviderErrorCode(code: ProviderErrorCode) {
    if (code === ProviderErrorCode.Canceled) return "canceled";
    if (code === ProviderErrorCode.Timeout) return "timeout";
    return code;
}

function normalizeProviderErrorMessage(error: ProviderError, fallback: string) {
    if (error.code === ProviderErrorCode.Canceled) return "请求已取消";
    if (error.code === ProviderErrorCode.Timeout) return error.message || "请求超时，请稍后重试";
    return error.message || fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}