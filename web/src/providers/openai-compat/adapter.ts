import { pollUntil } from "../core/polling";
import { ProviderError, ProviderErrorCode, type AdapterContext, type GenerateRequest, type GenerateResult, type JsonObject, type ProviderAdapter, type ProviderManifest, type ProviderOutput } from "../core/types";
import manifest from "./manifest.json";

export const openAICompatManifest = manifest as ProviderManifest;

export const openAICompatAdapter: ProviderAdapter = {
    manifest: openAICompatManifest,
    async generate(request, context) {
        if (request.capability === "image") return generateImage(request, context);
        if (request.capability === "audio") return generateAudio(request, context);
        if (request.capability === "video") return generateVideo(request, context);
        throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `OpenAI Compatible 不支持 ${request.capability}`, { details: { capability: request.capability } });
    },
    async testConnection(request, context) {
        await getJson(context, request.auth, "/models", request.signal);
        return { ok: true, message: "连接可用" };
    },
};

type VideoTask = {
    readonly id?: string;
    readonly status?: string;
    readonly error?: { readonly message?: string } | null;
    readonly content?: { readonly video_url?: string; readonly url?: string } | null;
    readonly url?: string;
};

async function generateImage(request: GenerateRequest, context: AdapterContext): Promise<GenerateResult> {
    const params = request.params;
    const references = referenceImageUrls(params);
    if (references.length) {
        const payload = await postFormData(context, params, "/images/edits", await buildReferenceImageFormData(context, params, request, references), request.signal);
        const outputs = imageOutputs(payload);
        if (!outputs.length) throw new ProviderError(ProviderErrorCode.AdapterError, "图像编辑接口没有返回图片");
        return result(request, outputs, payload);
    }

    const payload = await postJson(context, params, "/images/generations", {
        model: modelId(request),
        prompt: requiredString(params, "prompt"),
        ...(stringParam(params, "size") ? { size: stringParam(params, "size") } : {}),
        ...(stringParam(params, "quality") ? { quality: stringParam(params, "quality") } : {}),
        ...(numberParam(params, "count") ? { n: numberParam(params, "count") } : {}),
        ...(stringParam(params, "responseFormat") ? { response_format: stringParam(params, "responseFormat") } : {}),
    }, request.signal);

    const outputs = imageOutputs(payload);
    if (!outputs.length) throw new ProviderError(ProviderErrorCode.AdapterError, "图像接口没有返回图片");
    return result(request, outputs, payload);
}

async function buildReferenceImageFormData(context: AdapterContext, params: JsonObject, request: GenerateRequest, references: readonly string[]) {
    const formData = new FormData();
    formData.set("model", modelId(request));
    formData.set("prompt", requiredString(params, "prompt"));
    if (stringParam(params, "size")) formData.set("size", stringParam(params, "size"));
    if (stringParam(params, "quality")) formData.set("quality", stringParam(params, "quality"));
    if (numberParam(params, "count")) formData.set("n", String(numberParam(params, "count")));
    if (stringParam(params, "responseFormat")) formData.set("response_format", stringParam(params, "responseFormat"));

    for (let index = 0; index < references.length; index += 1) {
        const reference = references[index];
        const file = await fetchReferenceImage(context, reference, request.signal, index);
        formData.append("image", file.blob, file.filename);
    }

    return formData;
}

async function postFormData(context: AdapterContext, params: JsonObject, path: string, formData: FormData, signal: AbortSignal | undefined) {
    const response = await context.fetch(apiUrl(params, path), {
        method: "POST",
        headers: headers(params, null),
        body: formData,
        signal,
    });
    await assertOk(response);
    return readJson(response);
}

async function fetchReferenceImage(context: AdapterContext, url: string, signal: AbortSignal | undefined, index: number) {
    const response = await context.fetch(url, { signal });
    await assertOk(response);
    const blob = await response.blob();
    return {
        blob,
        filename: referenceFilename(url, index, response.headers.get("content-type") || blob.type || "image/png"),
    };
}

function referenceImageUrls(params: JsonObject) {
    const value = params.referenceImages;
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (isRecord(item) && typeof item.url === "string" ? item.url.trim() : ""))
        .filter((url) => Boolean(url));
}

function referenceFilename(url: string, index: number, contentType: string) {
    const suffix = contentType.includes("jpeg") ? ".jpg" : contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : "";
    if (url.startsWith("data:")) return `reference-${index + 1}${suffix || ".png"}`;
    try {
        const name = new URL(url).pathname.split("/").filter(Boolean).pop();
        if (name) return name.includes(".") ? name : `${name}${suffix}`;
    } catch {
        return `reference-${index + 1}${suffix || ".png"}`;
    }
    return `reference-${index + 1}${suffix || ".png"}`;
}

async function generateAudio(request: GenerateRequest, context: AdapterContext): Promise<GenerateResult> {
    const params = request.params;
    const response = await context.fetch(apiUrl(params, "/audio/speech"), {
        method: "POST",
        headers: headers(params),
        body: JSON.stringify({
            model: modelId(request),
            input: requiredString(params, "input"),
            ...(stringParam(params, "voice") ? { voice: stringParam(params, "voice") } : {}),
            ...(stringParam(params, "format") ? { response_format: stringParam(params, "format") } : {}),
            ...(numberParam(params, "speed") ? { speed: numberParam(params, "speed") } : {}),
            ...(stringParam(params, "instructions") ? { instructions: stringParam(params, "instructions") } : {}),
        }),
        signal: request.signal,
    });
    await assertOk(response);
    const blob = await response.blob();
    return result(request, [{ type: "audio", blob, mimeType: response.headers.get("content-type") || "audio/mpeg" }], undefined);
}

async function generateVideo(request: GenerateRequest, context: AdapterContext): Promise<GenerateResult> {
    const params = request.params;
    const created = normalizeTask(
        await postJson(
            context,
            params,
            "/videos",
            {
                model: modelId(request),
                prompt: requiredString(params, "prompt"),
                ...(stringParam(params, "size") ? { size: stringParam(params, "size") } : {}),
                ...(numberParam(params, "seconds") ? { seconds: numberParam(params, "seconds") } : {}),
            },
            request.signal,
        ),
    );
    const taskId = created.id;
    if (!taskId) throw new ProviderError(ProviderErrorCode.AdapterError, "视频接口没有返回任务 ID");
    await context.updateTask?.({ runtimeTaskId: taskId, status: "running", message: created.status });

    const finalTask = await pollUntil({
        poll: async () => normalizeTask(await getJson(context, params, `/videos/${encodeURIComponent(taskId)}`, request.signal)),
        until: (task) => isTerminalVideoStatus(task.status),
        intervalMs: numberParam(params, "pollIntervalMs") || 2500,
        timeoutMs: numberParam(params, "timeoutMs") || 5 * 60 * 1000,
        signal: request.signal,
        onProgress: ({ attempt, elapsedMs, value }) => {
            void context.updateTask?.({ runtimeTaskId: taskId, status: "running", message: value.status, metadata: { attempt, elapsedMs } });
        },
    });

    if (isFailedVideoStatus(finalTask.status)) {
        throw new ProviderError(ProviderErrorCode.AdapterError, finalTask.error?.message || "视频生成失败", { details: { taskId, status: finalTask.status || "failed" } });
    }

    const url = finalTask.url || finalTask.content?.video_url || finalTask.content?.url;
    if (url) return result(request, [{ type: "video", url, mimeType: "video/mp4" }], finalTask);

    const content = await context.fetch(apiUrl(params, `/videos/${encodeURIComponent(taskId)}/content`), { headers: headers(params), signal: request.signal });
    await assertOk(content);
    const blob = await content.blob();
    return result(request, [{ type: "video", blob, mimeType: content.headers.get("content-type") || "video/mp4" }], finalTask);
}

async function postJson(context: AdapterContext, params: JsonObject, path: string, payload: JsonObject, signal: AbortSignal | undefined) {
    const response = await context.fetch(apiUrl(params, path), {
        method: "POST",
        headers: headers(params),
        body: JSON.stringify(payload),
        signal,
    });
    await assertOk(response);
    return readJson(response);
}

async function getJson(context: AdapterContext, params: JsonObject, path: string, signal: AbortSignal | undefined) {
    const response = await context.fetch(apiUrl(params, path), { headers: headers(params), signal });
    await assertOk(response);
    return readJson(response);
}

async function assertOk(response: Response) {
    if (response.ok) return;
    const payload = await readJson(response);
    throw new ProviderError(ProviderErrorCode.NetworkError, errorMessage(payload) || `Provider 请求失败：${response.status}`, { details: { status: response.status } });
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function imageOutputs(payload: unknown): ProviderOutput[] {
    const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const outputs: ProviderOutput[] = [];
    data.forEach((item) => {
        if (!isRecord(item)) return;
        if (typeof item.b64_json === "string" && item.b64_json) outputs.push({ type: "image", dataUrl: `data:image/png;base64,${item.b64_json}`, mimeType: "image/png" });
        else if (typeof item.url === "string" && item.url) outputs.push({ type: "image", url: item.url });
    });
    return outputs;
}

function normalizeTask(payload: unknown): VideoTask {
    const value = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    return isRecord(value) ? (value as VideoTask) : {};
}

function isTerminalVideoStatus(status: string | undefined) {
    return ["completed", "succeeded", "failed", "cancelled", "canceled", "expired"].includes((status || "").toLowerCase());
}

function isFailedVideoStatus(status: string | undefined) {
    return ["failed", "cancelled", "canceled", "expired"].includes((status || "").toLowerCase());
}

function result(request: GenerateRequest, outputs: ProviderOutput[], raw: unknown): GenerateResult {
    return {
        providerId: openAICompatManifest.id,
        capability: request.capability,
        modelId: modelId(request),
        outputs,
        raw,
    };
}

function apiUrl(params: JsonObject, path: string) {
    const baseUrl = requiredString(params, "baseUrl").replace(/\/+$/, "");
    const lowerBaseUrl = baseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? baseUrl : `${baseUrl}/v1`;
    return `${apiBaseUrl}/${path.replace(/^\/+/, "")}`;
}

function headers(params: JsonObject, contentType: string | null = "application/json") {
    return {
        ...(contentType ? { "Content-Type": contentType } : {}),
        Authorization: `Bearer ${requiredString(params, "apiKey")}`,
    };
}

function modelId(request: GenerateRequest) {
    return stringParam(request.params, "model") || request.modelId;
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

function errorMessage(payload: unknown): string | undefined {
    if (!isRecord(payload)) return undefined;
    if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.msg === "string") return payload.msg;
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}