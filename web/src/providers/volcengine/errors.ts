import type { ProviderErrorCode } from "../core/types";

export function mapVolcengineErrorToCode(error: unknown): ProviderErrorCode {
    if (typeof error === "object" && error !== null) {
        const err = error as { message?: string; code?: number | string };
        const message = err.message?.toLowerCase() || "";

        // 网络错误
        if (message.includes("network") || message.includes("fetch")) {
            return "network_error";
        }

        // 认证错误
        if (message.includes("unauthorized") || message.includes("authentication") || message.includes("api key")) {
            return "invalid_api_key";
        }

        // 参数错误
        if (message.includes("invalid") || message.includes("参数") || message.includes("校验")) {
            return "invalid_request";
        }

        // 超时
        if (message.includes("timeout") || message.includes("超时")) {
            return "timeout";
        }

        // 配额/限流
        if (message.includes("quota") || message.includes("rate limit") || message.includes("限流")) {
            return "rate_limit_exceeded";
        }

        // 任务失败
        if (message.includes("failed") || message.includes("失败")) {
            return "provider_error";
        }
    }

    return "unknown_error";
}

export function createVolcengineError(message: string, code?: ProviderErrorCode): Error {
    const error = new Error(message);
    (error as any).code = code || "provider_error";
    return error;
}
