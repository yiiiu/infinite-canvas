import { ProviderError, ProviderErrorCode, type AdapterContext, type GenerateRequest, type GenerateResult, type JsonObject, type JsonValue, type ProviderAdapter, type ProviderManifest, type ProviderOutput } from "../core/types";
import { normalizeGrsaiError } from "./errors";
import manifest from "./manifest.json";

export const grsaiManifest = manifest as ProviderManifest;

const GRSAI_DEFAULT_BASE_URL = "https://grsai.dakka.com.cn";

export const grsaiAdapter: ProviderAdapter = {
    manifest: grsaiManifest,
    async generate(request, context) {
        if (request.capability !== "image") {
            throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `GrsAI 不支持 ${request.capability}`, { details: { capability: request.capability } });
        }
        return generateImage(request, context);
    },
    async testConnection(request, context) {
        const apiKey = stringParam(request.auth, "apiKey");
        if (!apiKey) {
            throw new ProviderError(ProviderErrorCode.InvalidRequest, "缺少 API Key");
        }

        // 使用余额查询接口测试连接（直接使用原生 fetch 绕过代理）
        const baseUrl = (stringParam(request.auth, "baseUrl") || GRSAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
        const url = `${baseUrl}/client/openapi/getAPIKeyCredits`;

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ apiKey }),
                signal: request.signal,
            });

            const body = await response.json();

            if (!response.ok || body.code !== 0) {
                throw normalizeGrsaiError(response.status, body, "GrsAI 连接测试失败");
            }

            return { ok: true, message: "连接成功" };
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            throw new ProviderError(ProviderErrorCode.NetworkError, error instanceof Error ? error.message : "连接测试失败");
        }
    },
};

async function generateImage(request: GenerateRequest, context: AdapterContext): Promise<GenerateResult> {
    const params = request.params;
    const model = modelId(request);
    const payload: Record<string, JsonValue> = {
        model,
        prompt: requiredString(params, "prompt"),
        urls: referenceImageUrls(params),
        shutProgress: true,
        cdn: "zh",
    };

    const size = stringParam(params, "size") || stringParam(params, "imageSize");
    const aspectRatio = stringParam(params, "aspectRatio");
    const variants = numberParam(params, "variants") ?? numberParam(params, "count");

    if (size && !isNanoBananaModel(model)) {
        payload.size = size;
    }
    if (size && isNanoBananaModel(model)) {
        payload.imageSize = size;
    }
    if (aspectRatio && isNanoBananaModel(model)) {
        payload.aspectRatio = aspectRatio;
    }
    if (variants !== undefined) {
        payload.variants = variants;
    }

    const response = await postJson(context, params, grsaiPathForModel(model), payload, request.signal);
    const outputs = imageOutputs(response);
    if (!outputs.length) {
        throw new ProviderError(ProviderErrorCode.AdapterError, "GrsAI 图像接口没有返回图片", { details: { modelId: model } });
    }

    return {
        providerId: grsaiManifest.id,
        capability: request.capability,
        modelId: model,
        outputs,
        raw: response,
    };
}

async function postJson(context: AdapterContext, params: JsonObject, path: string, payload: JsonObject, signal: AbortSignal | undefined) {
    const response = await context.fetch(apiUrl(params, path), {
        method: "POST",
        headers: headers(params),
        body: JSON.stringify(payload),
        signal,
    });
    const body = await readJson(response);
    if (!response.ok) {
        throw normalizeGrsaiError(response.status, body, "GrsAI 请求失败");
    }
    if (isFailedResponse(body)) {
        throw normalizeGrsaiError(response.status, body, "GrsAI 返回了失败状态");
    }
    return body;
}

async function getJson(context: AdapterContext, params: JsonObject, path: string, signal: AbortSignal | undefined) {
    const response = await context.fetch(apiUrl(params, path), { headers: headers(params), signal });
    const body = await readJson(response);
    if (!response.ok) {
        throw normalizeGrsaiError(response.status, body, "GrsAI 连接测试失败");
    }
    return body;
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    const jsonText = text.startsWith("data: ") ? text.slice(6) : text;
    try {
        return JSON.parse(jsonText) as unknown;
    } catch {
        return text;
    }
}

function imageOutputs(payload: unknown): ProviderOutput[] {
    const response = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    const candidates = isRecord(response) && Array.isArray(response.results) ? response.results : [];
    const outputs: ProviderOutput[] = [];

    if (isRecord(response) && typeof response.url === "string" && response.url) {
        outputs.push({ type: "image", url: response.url });
    }

    for (const item of candidates) {
        if (!isRecord(item)) continue;
        if (typeof item.url === "string" && item.url) {
            outputs.push({ type: "image", url: item.url });
        }
    }

    if (!outputs.length && isRecord(response) && Array.isArray((response as { readonly data?: readonly unknown[] }).data)) {
        for (const item of (response as { readonly data?: readonly unknown[] }).data || []) {
            if (!isRecord(item)) continue;
            if (typeof item.url === "string" && item.url) {
                outputs.push({ type: "image", url: item.url });
            }
            if (typeof item.b64_json === "string" && item.b64_json) {
                outputs.push({ type: "image", dataUrl: `data:image/png;base64,${item.b64_json}`, mimeType: "image/png" });
            }
        }
    }

    return outputs;
}

function isFailedResponse(payload: unknown) {
    if (!isRecord(payload)) return false;
    if (typeof payload.status === "string") {
        return !["succeeded", "completed", "success"].includes(payload.status.toLowerCase());
    }
    return typeof payload.code === "number" && payload.code !== 0 && payload.code !== 200;
}

function apiUrl(params: JsonObject, path: string) {
    const baseUrl = (stringParam(params, "baseUrl") || GRSAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const lowerBaseUrl = baseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    return `${apiBaseUrl}/${path.replace(/^\/+/, "")}`;
}

function headers(params: JsonObject) {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requiredString(params, "apiKey")}`,
    };
}

function grsaiPathForModel(model: string) {
    if (model.startsWith("nano-banana")) return "/draw/nano-banana";
    if (model.startsWith("flux")) return "/draw/flux";
    return "/draw/completions";
}

function isNanoBananaModel(model: string) {
    return model.startsWith("nano-banana");
}

function modelId(request: GenerateRequest) {
    return stringParam(request.params, "model") || request.modelId;
}

function referenceImageUrls(params: JsonObject) {
    const value = params.referenceImages;
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (isRecord(item) && typeof item.url === "string" ? item.url.trim() : ""))
        .filter((url) => Boolean(url));
}

function requiredString(params: JsonObject, key: string) {
    const value = stringParam(params, key);
    if (!value) throw new ProviderError(ProviderErrorCode.InvalidRequest, `缺少参数：${key}`, { details: { key } });
    return value;
}

function stringParam(params: JsonObject, key: string) {
    const value = params[key];
    return typeof value === "string" ? value.trim() : "";
}

function numberParam(params: JsonObject, key: string) {
    const value = params[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}