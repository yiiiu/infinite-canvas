import { ProviderError, ProviderErrorCode, type ProviderFetch } from "./types";

export function createProxyFetch(baseFetch: ProviderFetch = fetch): ProviderFetch {
    return async (url, init) => {
        try {
            return await baseFetch(resolveFetchUrl(url), init);
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            if (isAbortError(error)) throw new ProviderError(ProviderErrorCode.Canceled, "请求已取消", { cause: error });
            throw new ProviderError(ProviderErrorCode.NetworkError, error instanceof Error ? error.message : "Provider 请求失败", { cause: error });
        }
    };
}

export const proxyFetch: ProviderFetch = createProxyFetch();

function resolveFetchUrl(url: string | URL) {
    const rawUrl = stringifyUrl(url);

    // 在服务器端，直接返回原始 URL（会失败，但至少不会卡住）
    // 实际上，所有 provider 请求都应该在客户端执行
    if (!isBrowserRuntime()) {
        console.warn('[proxyFetch] Attempting to fetch from server-side, this may fail:', rawUrl);
        return rawUrl;
    }

    let target: URL;
    try {
        target = new URL(rawUrl, window.location.href);
    } catch {
        return rawUrl;
    }

    if (target.origin === window.location.origin) return rawUrl;
    if (target.protocol !== "http:" && target.protocol !== "https:") return rawUrl;
    return `/api/proxy?url=${encodeURIComponent(target.href)}`;
}

function stringifyUrl(url: string | URL) {
    return url instanceof URL ? url.href : url;
}

function isBrowserRuntime() {
    return typeof window !== "undefined" && typeof window.location !== "undefined";
}

function isAbortError(error: unknown) {
    return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}