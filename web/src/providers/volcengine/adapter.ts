import type { ProviderAdapter, ProviderGenerateRequest, ProviderGenerateResponse, ProviderAdapterContext } from "../core/types";
import { pollUntil } from "../core/polling";
import { normalizeProviderError } from "../core/error-normalize";
import { mapVolcengineErrorToCode, createVolcengineError } from "./errors";
import manifest from "./manifest.json";
import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import {
    boolConfig,
    buildSeedancePromptText,
    normalizeSeedanceDuration,
    normalizeSeedanceRatio,
    normalizeSeedanceResolution,
    seedanceVideoReferenceError,
    SEEDANCE_REFERENCE_LIMITS,
} from "@/lib/seedance-video";

type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    result?: {
        videos?: Array<{ url?: string }>;
    };
    error?: {
        code?: string;
        message?: string;
    };
};

type SeedanceContentItem = {
    type: "text" | "image_url" | "video_url" | "audio_url";
    text?: string;
    image_url?: { url: string };
    video_url?: { url: string };
    audio_url?: { url: string };
};

const SEEDANCE_POLL_INTERVAL = 3000;
const SEEDANCE_POLL_TIMEOUT = 600000; // 10 minutes

/**
 * 解析图片 URL：public URL > asset:// > blob: > storageKey dataUrl
 */
async function resolveSeedanceImageUrl(image: { url?: string; storageKey?: string }, ctx: ProviderAdapterContext): Promise<string> {
    if (image.url) {
        if (isPublicUrl(image.url)) return image.url;
        if (image.url.startsWith("asset://")) return image.url;
        if (image.url.startsWith("blob:")) {
            const blob = await ctx.fetch(image.url).then((res) => res.blob());
            return blobToDataUrl(blob);
        }
    }
    if (image.storageKey) {
        const blob = await getMediaBlob(image.storageKey);
        return blobToDataUrl(blob);
    }
    throw createVolcengineError("参考图片 URL 无效", "invalid_request");
}

/**
 * 解析视频 URL：public URL > asset:// > blob: > storageKey dataUrl
 */
async function resolveSeedanceVideoUrl(video: { url?: string; storageKey?: string }, ctx: ProviderAdapterContext): Promise<string> {
    if (video.url) {
        if (isPublicUrl(video.url)) return video.url;
        if (video.url.startsWith("asset://")) return video.url;
        if (video.url.startsWith("blob:")) {
            const blob = await ctx.fetch(video.url).then((res) => res.blob());
            return blobToDataUrl(blob);
        }
    }
    if (video.storageKey) {
        const blob = await getMediaBlob(video.storageKey);
        return blobToDataUrl(blob);
    }
    throw createVolcengineError("参考视频 URL 无效", "invalid_request");
}

/**
 * 解析音频 URL：public URL > asset:// > blob: > storageKey dataUrl
 */
async function resolveSeedanceAudioUrl(audio: { url?: string; storageKey?: string }, ctx: ProviderAdapterContext): Promise<string> {
    if (audio.url) {
        if (isPublicUrl(audio.url)) return audio.url;
        if (audio.url.startsWith("asset://")) return audio.url;
        if (audio.url.startsWith("blob:")) {
            const blob = await ctx.fetch(audio.url).then((res) => res.blob());
            return blobToDataUrl(blob);
        }
    }
    if (audio.storageKey) {
        const blob = await getMediaBlob(audio.storageKey);
        return blobToDataUrl(blob);
    }
    throw createVolcengineError("参考音频 URL 无效", "invalid_request");
}

/**
 * 构建 Seedance content 数组
 */
async function buildSeedanceContent(
    prompt: string,
    images: Array<{ url?: string; storageKey?: string }>,
    videos: Array<{ url?: string; storageKey?: string }>,
    audios: Array<{ url?: string; storageKey?: string }>,
    ctx: ProviderAdapterContext,
): Promise<SeedanceContentItem[]> {
    const content: SeedanceContentItem[] = [];

    // 1. 文本 prompt（带参考资源描述）
    const promptText = buildSeedancePromptText(prompt, images, videos, audios);
    if (promptText) {
        content.push({ type: "text", text: promptText });
    }

    // 2. 参考图片
    for (const image of images) {
        const url = await resolveSeedanceImageUrl(image, ctx);
        content.push({ type: "image_url", image_url: { url } });
    }

    // 3. 参考视频
    for (const video of videos) {
        const url = await resolveSeedanceVideoUrl(video, ctx);
        content.push({ type: "video_url", video_url: { url } });
    }

    // 4. 参考音频
    for (const audio of audios) {
        const url = await resolveSeedanceAudioUrl(audio, ctx);
        content.push({ type: "audio_url", audio_url: { url } });
    }

    return content;
}

/**
 * 创建 Seedance 任务
 */
async function createSeedanceTask(request: ProviderGenerateRequest, ctx: ProviderAdapterContext): Promise<string> {
    const { baseUrl, apiKey, model, prompt } = request.params as {
        baseUrl: string;
        apiKey: string;
        model: string;
        prompt: string;
        ratio?: string;
        resolution?: string;
        videoSeconds?: number;
        generate_audio?: boolean;
        watermark?: boolean;
    };

    // 参数 normalize
    const ratio = normalizeSeedanceRatio(request.params.ratio as string);
    const resolution = normalizeSeedanceResolution(request.params.resolution as string);
    const duration = normalizeSeedanceDuration(request.params.videoSeconds as number);
    const generateAudio = boolConfig(request.params.generate_audio, true);
    const watermark = boolConfig(request.params.watermark, false);

    // 参考资源
    const images = (request.referenceImages || []) as Array<{ url?: string; storageKey?: string }>;
    const videos = (request.referenceVideos || []) as Array<{ url?: string; storageKey?: string; durationMs?: number; width?: number; height?: number }>;
    const audios = (request.referenceAudios || []) as Array<{ url?: string; storageKey?: string }>;

    // 数量校验
    if (images.length > SEEDANCE_REFERENCE_LIMITS.images) {
        throw createVolcengineError(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.images} 张参考图片`, "invalid_request");
    }
    if (videos.length > SEEDANCE_REFERENCE_LIMITS.videos) {
        throw createVolcengineError(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.videos} 个参考视频`, "invalid_request");
    }
    if (audios.length > SEEDANCE_REFERENCE_LIMITS.audios) {
        throw createVolcengineError(`Seedance 最多支持 ${SEEDANCE_REFERENCE_LIMITS.audios} 个参考音频`, "invalid_request");
    }

    // 时长校验
    const videoError = seedanceVideoReferenceError(videos);
    if (videoError) {
        throw createVolcengineError(videoError, "invalid_request");
    }

    // 构建 content
    const content = await buildSeedanceContent(prompt, images, videos, audios, ctx);

    // 构建请求 body
    const body = {
        model,
        content,
        ratio,
        resolution,
        duration,
        generate_audio: generateAudio,
        watermark,
    };

    // 发起请求
    const url = `${baseUrl.replace(/\/$/, "")}/video/generations`;
    const response = await ctx.fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `视频生成请求失败 (${response.status})`;
        try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.msg || errorData.message || errorData.error?.message || errorMessage;
        } catch {
            // 解析失败，使用默认错误信息
        }
        throw createVolcengineError(errorMessage, mapVolcengineErrorToCode({ message: errorMessage }));
    }

    const data = await response.json();
    const taskId = data.id || data.data?.id;
    if (!taskId) {
        throw createVolcengineError("视频生成任务创建失败：未返回任务 ID", "provider_error");
    }

    return taskId;
}

/**
 * 轮询 Seedance 任务状态
 */
async function pollSeedanceTask(taskId: string, request: ProviderGenerateRequest, ctx: ProviderAdapterContext): Promise<SeedanceTask> {
    const { baseUrl, apiKey } = request.params as { baseUrl: string; apiKey: string };

    const fetchTask = async (): Promise<SeedanceTask> => {
        const url = `${baseUrl.replace(/\/$/, "")}/video/generations/${taskId}`;
        const response = await ctx.fetch(url, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            signal: request.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `查询任务状态失败 (${response.status})`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.msg || errorData.message || errorData.error?.message || errorMessage;
            } catch {
                // 解析失败，使用默认错误信息
            }
            throw createVolcengineError(errorMessage, mapVolcengineErrorToCode({ message: errorMessage }));
        }

        const data = await response.json();
        return data.data || data;
    };

    return pollUntil(
        fetchTask,
        (task) => {
            if (task.status === "succeeded") return "completed";
            if (task.status === "failed" || task.status === "cancelled" || task.status === "expired") return "failed";
            return "pending";
        },
        {
            interval: SEEDANCE_POLL_INTERVAL,
            timeout: SEEDANCE_POLL_TIMEOUT,
            signal: request.signal,
        },
    );
}

/**
 * Volcengine (Seedance) Adapter
 */
export const volcengineAdapter: ProviderAdapter = {
    id: manifest.id,
    manifest,

    async generate(request: ProviderGenerateRequest, ctx: ProviderAdapterContext): Promise<ProviderGenerateResponse> {
        try {
            // 1. 创建任务
            const taskId = await createSeedanceTask(request, ctx);

            // 2. 轮询任务状态
            const task = await pollSeedanceTask(taskId, request, ctx);

            // 3. 解析结果
            if (task.status === "succeeded") {
                const videoUrl = task.result?.videos?.[0]?.url;
                if (!videoUrl) {
                    throw createVolcengineError("视频生成成功但未返回视频 URL", "provider_error");
                }

                // 下载并上传视频
                const videoBlob = await ctx.fetch(videoUrl, { signal: request.signal }).then((res) => res.blob());
                const videoFile = dataUrlToFile(await blobToDataUrl(videoBlob), "generated-video.mp4");
                const uploaded: UploadedFile = await uploadMediaFile(videoFile);

                return {
                    outputs: [
                        {
                            type: "video",
                            url: uploaded.url,
                        },
                    ],
                };
            }

            // 任务失败
            const errorMessage = task.error?.message || "视频生成失败";
            throw createVolcengineError(errorMessage, "provider_error");
        } catch (error) {
            throw normalizeProviderError(error, mapVolcengineErrorToCode);
        }
    },
};

export const volcengineManifest = manifest;

// Utility functions
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
