import {
    ProviderError,
    ProviderErrorCode,
    type AdapterContext,
    type GenerateRequest,
    type GenerateResult,
    type ProviderAdapter,
    type ProviderManifest,
} from "../core/types";
import { pollUntil } from "../core/polling";
import manifest from "./manifest.json";
import { getMediaBlob } from "@/services/file-storage";
import {
    boolConfig,
    buildSeedancePromptText,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";

export const volcengineManifest = manifest as ProviderManifest;

type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    content?: {
        video_url?: string;
        url?: string;
    };
    result?: {
        videos?: Array<{ url?: string }>;
    };
    error?: { code?: string; message?: string };
};

type ReferenceAsset = { url?: string; storageKey?: string };
type ReferenceVideo = ReferenceAsset & { durationMs?: number; width?: number; height?: number; bytes?: number };

const SEEDANCE_POLL_INTERVAL = 3000;
const SEEDANCE_POLL_TIMEOUT = 600000;
const VOLCENGINE_BASE_URL_HINT = "火山方舟 Base URL 应以 `ark.cn-beijing.volces.com/api/v3` 或 `ark.cn-beijing.volces.com/api/plan/v3` 结尾";
const VOLCENGINE_BASE_URL_HOST = "ark.cn-beijing.volces.com";
const VOLCENGINE_BASE_URL_PATHS = ["/api/v3", "/api/plan/v3"] as const;

function isPublicUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}

async function resolveAssetUrl(asset: ReferenceAsset, ctx: AdapterContext, errorLabel: string): Promise<string> {
    if (asset.url) {
        if (isPublicUrl(asset.url) || asset.url.startsWith("asset://")) return asset.url;
        if (asset.url.startsWith("blob:")) {
            const blob = await ctx.fetch(asset.url).then((r) => r.blob());
            return blobToDataUrl(blob);
        }
    }
    if (asset.storageKey) {
        const blob = await getMediaBlob(asset.storageKey);
        if (!blob) throw new ProviderError(ProviderErrorCode.InvalidRequest, `${errorLabel} 文件不存在`);
        return blobToDataUrl(blob);
    }
    throw new ProviderError(ProviderErrorCode.InvalidRequest, `${errorLabel} URL 无效`);
}

async function buildSeedanceContent(
    prompt: string,
    images: ReferenceAsset[],
    videos: ReferenceVideo[],
    audios: ReferenceAsset[],
    ctx: AdapterContext,
): Promise<Array<Record<string, unknown>>> {
    const content: Array<Record<string, unknown>> = [];

    const text = buildSeedancePromptText(prompt, images as never, videos as never, audios as never);
    if (text) content.push({ type: "text", text });

    for (const image of images) {
        const url = await resolveAssetUrl(image, ctx, "参考图片");
        content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
    for (const video of videos) {
        const url = await resolveAssetUrl(video, ctx, "参考视频");
        content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
    }
    for (const audio of audios) {
        const url = await resolveAssetUrl(audio, ctx, "参考音频");
        content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
    }

    return content;
}

async function createSeedanceTask(request: GenerateRequest, ctx: AdapterContext): Promise<string> {
    const p = request.params;
    const baseUrl = normalizeVolcengineBaseUrl(p.baseUrl);
    const apiKey = String(p.apiKey || "");
    const model = String(p.model || "");
    const prompt = String(p.prompt || "");

    const images = ((p.referenceImages as ReferenceAsset[] | undefined) || []).slice(0, SEEDANCE_REFERENCE_LIMITS.images);
    const videos = ((p.referenceVideos as ReferenceVideo[] | undefined) || []).slice(0, SEEDANCE_REFERENCE_LIMITS.videos);
    const audios = ((p.referenceAudios as ReferenceAsset[] | undefined) || []).slice(0, SEEDANCE_REFERENCE_LIMITS.audios);

    if ((p.referenceImages as unknown[])?.length > SEEDANCE_REFERENCE_LIMITS.images)
        throw new ProviderError(ProviderErrorCode.InvalidRequest, `Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.images} 张参考图片`);
    if ((p.referenceVideos as unknown[])?.length > SEEDANCE_REFERENCE_LIMITS.videos)
        throw new ProviderError(ProviderErrorCode.InvalidRequest, `Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.videos} 个参考视频`);
    if ((p.referenceAudios as unknown[])?.length > SEEDANCE_REFERENCE_LIMITS.audios)
        throw new ProviderError(ProviderErrorCode.InvalidRequest, `Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.audios} 个参考音频`);

    const videoError = seedanceVideoReferenceError(videos as never);
    if (videoError) throw new ProviderError(ProviderErrorCode.InvalidRequest, videoError);

    const content = await buildSeedanceContent(prompt, images, videos, audios, ctx);

    const body = {
        model,
        content,
        ratio: normalizeSeedanceRatio(String(p.ratio || "")),
        resolution: normalizeSeedanceResolution(String(p.resolution || ""), model),
        duration: normalizeSeedanceDuration(String(p.videoSeconds ?? "")),
        generate_audio: boolConfig(p.generate_audio as string | undefined, true),
        watermark: boolConfig(p.watermark as string | undefined, false),
    };

    const response = await ctx.fetch(`${baseUrl}/contents/generations/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: request.signal,
    });

    const data = await response.json();
    const unwrapped = unwrapEnvelope(data, "Seedance 接口没有返回任务");
    if (!response.ok || !unwrapped.id) {
        const msg = (data as Record<string, string>).msg || `Seedance 任务创建失败（${response.status}）`;
        throw new ProviderError(ProviderErrorCode.AdapterError, msg);
    }
    return unwrapped.id;
}

function unwrapEnvelope(data: Record<string, unknown>, emptyMsg: string): SeedanceTask {
    if (!data) throw new ProviderError(ProviderErrorCode.AdapterError, emptyMsg);
    if (typeof data.code === "number") {
        if (data.code !== 0) throw new ProviderError(ProviderErrorCode.AdapterError, String(data.msg || "请求失败"));
        if (!data.data) throw new ProviderError(ProviderErrorCode.AdapterError, emptyMsg);
        return data.data as SeedanceTask;
    }
    return data as unknown as SeedanceTask;
}

async function pollSeedanceTask(taskId: string, request: GenerateRequest, ctx: AdapterContext): Promise<SeedanceTask> {
    const baseUrl = normalizeVolcengineBaseUrl(request.params.baseUrl);
    const apiKey = String(request.params.apiKey || "");

    return pollUntil<SeedanceTask>({
        poll: async () => {
            const response = await ctx.fetch(`${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: request.signal,
            });
            const data = await response.json();
            return unwrapEnvelope(data, "Seedance 任务查询失败");
        },
        until: (task) => task.status === "succeeded" || task.status === "failed" || task.status === "cancelled" || task.status === "expired",
        intervalMs: SEEDANCE_POLL_INTERVAL,
        timeoutMs: SEEDANCE_POLL_TIMEOUT,
        signal: request.signal,
        onProgress: ({ attempt, elapsedMs, value }) => {
            void ctx.updateTask?.({ runtimeTaskId: taskId, status: "running", message: value.status, metadata: { attempt, elapsedMs } });
        },
    });
}

export const volcengineAdapter: ProviderAdapter = {
    manifest: volcengineManifest,

    async testConnection(request, ctx) {
        const baseUrl = normalizeVolcengineBaseUrl(request.auth.baseUrl);
        const apiKey = stringParam(request.auth, "apiKey");
        if (!apiKey) throw new ProviderError(ProviderErrorCode.InvalidRequest, "缺少 API Key");

        const response = await ctx.fetch(`${baseUrl}/contents/generations/tasks?page_num=1&page_size=1`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: request.signal,
        });
        const payload = await readJson(response);
        if (response.status === 401 || response.status === 403) {
            throw new ProviderError(ProviderErrorCode.Unauthorized, errorMessage(payload) || "Volcengine 鉴权失败", { details: { status: response.status } });
        }
        if (response.ok) return { ok: true, message: "连接成功" };
        if (response.status === 400 || response.status === 422) return { ok: true, message: "连接成功" };
        throw new ProviderError(ProviderErrorCode.NetworkError, errorMessage(payload) || `Volcengine 连接测试失败：${response.status}`, { details: { status: response.status } });
    },

    async generate(request: GenerateRequest, ctx: AdapterContext): Promise<GenerateResult> {
        if (request.capability !== "video") {
            throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `Volcengine 不支持 ${request.capability}`);
        }

        const taskId = await createSeedanceTask(request, ctx);
        await ctx.updateTask?.({ runtimeTaskId: taskId, status: "running", message: "created" });
        const task = await pollSeedanceTask(taskId, request, ctx);

        if (task.status === "succeeded") {
            const videoUrl = seedanceTaskVideoUrl(task);
            if (!videoUrl) throw new ProviderError(ProviderErrorCode.AdapterError, "视频生成成功但未返回视频 URL");

            const videoBlob = await ctx.fetch(videoUrl, { signal: request.signal }).then((r) => r.blob());
            return {
                providerId: volcengineManifest.id,
                capability: "video",
                modelId: String(request.params.model || ""),
                outputs: [{ type: "video", blob: videoBlob, mimeType: videoBlob.type || "video/mp4" }],
            };
        }

        const errorMsg = task.error?.message || `Seedance 视频生成${task.status === "expired" ? "超时" : "失败"}`;
        throw new ProviderError(ProviderErrorCode.AdapterError, errorMsg);
    },
};

function seedanceTaskVideoUrl(task: SeedanceTask) {
    return task.content?.video_url || task.content?.url || task.result?.videos?.[0]?.url;
}

function normalizeVolcengineBaseUrl(value: unknown) {
    const rawBaseUrl = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
    const baseUrl = rawBaseUrl && !/^https?:\/\//i.test(rawBaseUrl) ? `https://${rawBaseUrl}` : rawBaseUrl;
    if (!baseUrl) throw new ProviderError(ProviderErrorCode.InvalidRequest, "缺少 Base URL");
    const lower = baseUrl.toLowerCase();
    if (lower.includes("/contents/generations")) {
        throw new ProviderError(ProviderErrorCode.InvalidRequest, "Base URL 只需填到 `/api/v3` 或 `/api/plan/v3`，不要包含具体接口路径");
    }
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "").toLowerCase();
        if (url.hostname.toLowerCase() === VOLCENGINE_BASE_URL_HOST && VOLCENGINE_BASE_URL_PATHS.includes(path as (typeof VOLCENGINE_BASE_URL_PATHS)[number])) {
            url.pathname = path;
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/+$/, "");
        }
    } catch {
        // Fall through to the shared hint below.
    }
    throw new ProviderError(ProviderErrorCode.InvalidRequest, VOLCENGINE_BASE_URL_HINT);
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

function errorMessage(payload: unknown): string | undefined {
    if (!isRecord(payload)) return undefined;
    if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.msg === "string") return payload.msg;
    return undefined;
}

function stringParam(params: Record<string, unknown>, key: string) {
    const value = params[key];
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
