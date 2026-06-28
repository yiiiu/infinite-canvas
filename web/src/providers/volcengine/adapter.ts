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
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
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
    result?: {
        videos?: Array<{ url?: string }>;
    };
    error?: { code?: string; message?: string };
};

type ReferenceAsset = { url?: string; storageKey?: string };
type ReferenceVideo = ReferenceAsset & { durationMs?: number; width?: number; height?: number; bytes?: number };

const SEEDANCE_POLL_INTERVAL = 3000;
const SEEDANCE_POLL_TIMEOUT = 600000;

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
    const baseUrl = String(p.baseUrl || "").replace(/\/$/, "");
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
    const baseUrl = String(request.params.baseUrl || "").replace(/\/$/, "");
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
    });
}

export const volcengineAdapter: ProviderAdapter = {
    manifest: volcengineManifest,

    async generate(request: GenerateRequest, ctx: AdapterContext): Promise<GenerateResult> {
        if (request.capability !== "video") {
            throw new ProviderError(ProviderErrorCode.UnsupportedCapability, `Volcengine 不支持 ${request.capability}`);
        }

        const taskId = await createSeedanceTask(request, ctx);
        const task = await pollSeedanceTask(taskId, request, ctx);

        if (task.status === "succeeded") {
            const videoUrl = task.result?.videos?.[0]?.url;
            if (!videoUrl) throw new ProviderError(ProviderErrorCode.AdapterError, "视频生成成功但未返回视频 URL");

            const videoBlob = await ctx.fetch(videoUrl, { signal: request.signal }).then((r) => r.blob());
            const uploaded = await uploadMediaFile(videoBlob, "video");

            return {
                providerId: volcengineManifest.id,
                capability: "video",
                modelId: String(request.params.model || ""),
                outputs: [{ type: "video", url: uploaded.url }],
            };
        }

        const errorMsg = task.error?.message || `Seedance 视频生成${task.status === "expired" ? "超时" : "失败"}`;
        throw new ProviderError(ProviderErrorCode.AdapterError, errorMsg);
    },
};
