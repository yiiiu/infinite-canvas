import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { nanoid } from "nanoid";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { uploadImage } from "@/services/image-storage";
import { defaultProviderClient } from "@/providers";
import { scanProviderTaskRecovery, TaskStatus, useProviderTaskStore, type ProviderTaskContext } from "@/providers/task-store";
import { normalizeProviderError } from "@/providers/core/error-normalize";
import { proxyFetch } from "@/providers/core/proxy-fetch";
import { isNewProviderEnabled } from "@/providers/feature-flags";
import { aiConfigToProviderRequest } from "@/providers/openai-compat/config-bridge";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../../constants";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } from "../../components/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "../../components/canvas-node-prompt-panel";
import { fitNodeSize, nodeSizeFromRatio } from "../../utils/canvas-node-size";
import { audioMetadata, imageMetadata, videoMetadata } from "../../utils/canvas-node-config";
import {
    buildAudioGenerationMetadata,
    buildGenerationConfig,
    buildImageGenerationMetadata,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    isGenerationCanceled,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "../../utils/canvas-generation-helpers";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "../../types";

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
    pendingId?: string;
};

type MessageApi = {
    error: (content: string) => void;
    warning: (content: string) => void;
};

type ModalApi = {
    confirm: (config: { title: string; content: string; okText: string; cancelText: string; okButtonProps: { danger: boolean }; onOk: () => void }) => void;
};

type Params = {
    projectId: string;
    projectLoaded: boolean;
    effectiveConfig: any;
    isAiConfigReady: (config: any, model: string) => boolean;
    openConfigDialog: (open?: boolean) => void;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    generateNodeRef: MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    message: MessageApi;
    modal: ModalApi;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
        id,
        type,
        title: spec.title,
        position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

async function generateImageResult(config: AiConfig, prompt: string, references: ReferenceImage[], signal: AbortSignal, task?: CanvasProviderTask): Promise<{ dataUrl: string | Blob }> {
    if (shouldUseProvider(config, "image")) {
        const referenceImages = references
            .map(providerReferenceImageUrl)
            .filter((url): url is string => Boolean(url))
            .map((url) => ({ url }));
        const providerRequest = aiConfigToProviderRequest(config, "image", {
            prompt,
            count: 1,
            ...(referenceImages.length ? { referenceImages } : {}),
        });
        const result = await defaultProviderClient.generate(providerIdForParams(providerRequest.params), { ...providerRequest, signal, pendingId: task?.pendingId, taskContext: task?.taskContext });
        const image = result.outputs.find((output) => output.type === "image");
        if (image?.dataUrl) return { dataUrl: image.dataUrl };
        if (image?.url) return { dataUrl: await (await proxyFetch(image.url, { signal })).blob() };
        throw new Error("图像接口没有返回图片");
    }
    return references.length ? requestEdit({ ...config, count: "1" }, prompt, references, undefined, { signal }).then((items) => items[0]) : requestGeneration({ ...config, count: "1" }, prompt, { signal }).then((items) => items[0]);
}

function providerReferenceImageUrl(image: ReferenceImage) {
    return image.url || image.dataUrl;
}

type CanvasProviderTask = {
    pendingId: string;
    taskContext: ProviderTaskContext;
};

function createProviderTask(projectId: string, nodeId: string, referenceImages: ReferenceImage[] = []): CanvasProviderTask {
    const unrecoverable = hasUnrecoverableReferenceImages(referenceImages);
    return {
        pendingId: nanoid(),
        taskContext: {
            projectId,
            nodeId,
            referenceImageIds: referenceImages.map((image) => image.storageKey || image.id).filter((id): id is string => Boolean(id)),
            recoverable: !unrecoverable,
            unrecoverableReason: unrecoverable ? "参考图没有稳定 storageKey，无法跨刷新恢复" : undefined,
        },
    };
}

function hasUnrecoverableReferenceImages(referenceImages: ReferenceImage[]) {
    return referenceImages.some((image) => !image.storageKey && (image.dataUrl.startsWith("data:") || image.url?.startsWith("data:")));
}

function setNodeTaskMetadata(setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>, nodeId: string, pendingId: string, status: TaskStatus) {
    setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, task: { pendingId, status } } } : node)));
}

function providerIdForParams(params: { readonly baseUrl?: unknown }) {
    const baseUrl = typeof params.baseUrl === "string" ? params.baseUrl.toLowerCase() : "";
    return baseUrl.includes("grsai") ? "grsai" : "openai-compat";
}

async function generateAudioResult(config: AiConfig, prompt: string, signal: AbortSignal, task?: CanvasProviderTask): Promise<UploadedFile> {
    if (shouldUseProvider(config, "audio")) {
        const result = await defaultProviderClient.generate("openai-compat", { ...aiConfigToProviderRequest(config, "audio", { input: prompt }), signal, pendingId: task?.pendingId, taskContext: task?.taskContext });
        const audio = result.outputs.find((output) => output.type === "audio");
        if (audio?.blob) return storeGeneratedAudio(audio.blob, config.audioFormat);
        if (audio?.url) return storeGeneratedAudio(await (await proxyFetch(audio.url, { signal })).blob(), config.audioFormat);
        throw new Error("音频接口没有返回可播放的音频");
    }
    return storeGeneratedAudio(await requestAudioGeneration(config, prompt, { signal }), config.audioFormat);
}

async function generateVideoResult(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], signal: AbortSignal): Promise<UploadedFile> {
    return storeGeneratedVideo(await requestVideoGeneration(config, prompt, references, videoReferences, audioReferences, { signal }));
}

function shouldUseProvider(config: AiConfig, capability: "image" | "audio") {
    return config.apiFormat === "openai" && isNewProviderEnabled(capability);
}

function isCanvasGenerationCanceled(error: unknown) {
    return isGenerationCanceled(error) || normalizeProviderError(error).code === "canceled";
}

function generationErrorMessage(error: unknown) {
    return normalizeProviderError(error, "生成失败").message;
}

export function useCanvasGeneration({
    projectId,
    projectLoaded,
    effectiveConfig,
    isAiConfigReady,
    openConfigDialog,
    nodesRef,
    connectionsRef,
    generateNodeRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    message,
    modal,
}: Params) {
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController(), pendingId?: string) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller, pendingId });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const abortGenerationForNodeIds = useCallback((nodeIds: Iterable<string>) => {
        const ids = new Set(nodeIds);
        generationRequestsRef.current.forEach((request) => {
            if (!ids.has(request.targetNodeId) && !ids.has(request.originNodeId) && !ids.has(request.runningNodeId)) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            if (request.pendingId) useProviderTaskStore.getState().cancelTask(request.pendingId, "节点已删除，任务已取消");
        });
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            if (request.pendingId) useProviderTaskStore.getState().cancelTask(request.pendingId, "用户停止生成");
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } }
                    : node,
            ),
        );
    }, []);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationContext = await hydrateNodeGenerationContext(
                buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
            );
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } }
                                    : isEmptyImageNode
                                      ? { ...node, position: rootNode.position, width: rootNode.width, height: rootNode.height, title: rootNode.title, metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined } }
                                      : isImageNode
                                        ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } }
                                        : { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Prompt", width: parentConfig.width, height: parentConfig.height, metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined } }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    if (shouldUseProvider(generationConfig, "image") && hasUnrecoverableReferenceImages(referenceImages)) message.warning("当前参考图无法跨刷新恢复，刷新后需重新生成");
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            const task = shouldUseProvider(generationConfig, "image") ? createProviderTask(projectId, targetId, referenceImages) : undefined;
                            if (task) {
                                useProviderTaskStore.getState().supersedeNodeTasks(projectId, targetId, task.pendingId);
                                startGenerationRequest(targetId, nodeId, nodeId, controller, task.pendingId);
                                setNodeTaskMetadata(setNodes, targetId, task.pendingId, TaskStatus.Pending);
                            }
                            try {
                                const image = await generateImageResult(generationConfig, effectivePrompt, referenceImages, controller.signal, task);
                                const uploaded = await uploadImage(image.dataUrl);
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return { ...node, position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height, metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId } };
                                        if (node.id === targetId)
                                            return { ...node, position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height, metadata: { ...node.metadata, ...imageMetadata(uploaded) } };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (task) {
                                    useProviderTaskStore.getState().markWritten(task.pendingId);
                                    setNodeTaskMetadata(setNodes, targetId, task.pendingId, TaskStatus.Written);
                                }
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isCanvasGenerationCanceled(error)) {
                                    if (task) setNodeTaskMetadata(setNodes, targetId, task.pendingId, TaskStatus.Cancelled);
                                    return false;
                                }
                                const errorDetails = generationErrorMessage(error);
                                hasFailure = true;
                                if (task) setNodeTaskMetadata(setNodes, targetId, task.pendingId, TaskStatus.Failed);
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) => (isEmptyVideoNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode]));
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await generateVideoResult(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, controller.signal);
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) => prev.map((node) => (node.id === videoId ? { ...node, width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 }, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext) } } : node)));
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) => (isEmptyAudioNode ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode]));
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const task = shouldUseProvider(generationConfig, "audio") ? createProviderTask(projectId, audioId) : undefined;
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController, task?.pendingId);
                    if (task) {
                        useProviderTaskStore.getState().supersedeNodeTasks(projectId, audioId, task.pendingId);
                        setNodeTaskMetadata(setNodes, audioId, task.pendingId, TaskStatus.Pending);
                    }
                    try {
                        const audio = await generateAudioResult(generationConfig, effectivePrompt, controller.signal, task);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
                        if (task) {
                            useProviderTaskStore.getState().markWritten(task.pendingId);
                            setNodeTaskMetadata(setNodes, audioId, task.pendingId, TaskStatus.Written);
                        }
                    } catch (error) {
                        if (task) setNodeTaskMetadata(setNodes, audioId, task.pendingId, isCanvasGenerationCanceled(error) ? TaskStatus.Cancelled : TaskStatus.Failed);
                        throw error;
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map((targetNodeId) => {
                        let localStreamed = "";
                        return requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }), (text) => {
                            localStreamed = text;
                            streamed = text;
                            if (isConfigNode) return;
                            setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                        }, { signal: controller.signal }).then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed })).finally(() => finishGenerationRequest(targetNodeId, controller));
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                                : node,
                    ),
                );
            } catch (error) {
                if (isCanvasGenerationCanceled(error)) return;
                const errorDetails = generationErrorMessage(error);
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishGenerationRequest(nodeId, runController);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest],
    );

    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [generateNodeRef, handleGenerateNode]);

    useEffect(() => {
        if (!projectLoaded) return;
        let cancelled = false;
        const restoreTasks = async () => {
            const scan = scanProviderTaskRecovery({ projectId, nodeIds: nodesRef.current.map((node) => node.id) });
            if (scan.issues.length) message.warning("部分刷新前任务无法恢复");
            if (scan.needsResumeTasks.length) message.warning("部分异步任务需要重新发起生成");

            for (const task of scan.writeBackTasks) {
                if (cancelled) return;
                const image = task.result?.outputs.find((output) => output.type === "image");
                if (!image || image.type !== "image") {
                    useProviderTaskStore.getState().markUnrecoverable(task.pendingId, "任务结果类型暂不支持恢复写回");
                    continue;
                }
                try {
                    const imageSource = image.dataUrl && image.dataUrl !== "[data-url-removed]" ? image.dataUrl : image.url ? await (await proxyFetch(image.url)).blob() : null;
                    if (!imageSource) {
                        useProviderTaskStore.getState().markUnrecoverable(task.pendingId, "任务结果缺少可恢复图片地址");
                        continue;
                    }
                    const uploaded = await uploadImage(imageSource);
                    if (cancelled) return;
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const imageSize = fitNodeSize(uploaded.width, uploaded.height, spec.width, spec.height);
                    setNodes((prev) =>
                        prev.map((node) => {
                            if (node.id !== task.nodeId) return node;
                            const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                            return { ...node, position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height, metadata: { ...node.metadata, ...imageMetadata(uploaded), task: { pendingId: task.pendingId, status: TaskStatus.Written } } };
                        }),
                    );
                    useProviderTaskStore.getState().markWritten(task.pendingId);
                } catch (error) {
                    useProviderTaskStore.getState().markUnrecoverable(task.pendingId, generationErrorMessage(error));
                }
            }
        };
        void restoreTasks();
        return () => {
            cancelled = true;
        };
    }, [generateNodeRef, message, nodesRef, projectId, projectLoaded, setNodes]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages = hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            const retryTask = (node.type === CanvasNodeType.Image && shouldUseProvider(generationConfig, "image")) || (node.type === CanvasNodeType.Audio && shouldUseProvider(generationConfig, "audio")) ? createProviderTask(projectId, node.id, node.type === CanvasNodeType.Image ? retryImages : []) : undefined;
            if (retryTask && node.type === CanvasNodeType.Image && hasUnrecoverableReferenceImages(retryImages)) message.warning("当前参考图无法跨刷新恢复，刷新后需重新生成");
            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id, undefined, retryTask?.pendingId);
            if (retryTask) {
                useProviderTaskStore.getState().supersedeNodeTasks(projectId, node.id, retryTask.pendingId);
                setNodeTaskMetadata(setNodes, node.id, retryTask.pendingId, TaskStatus.Pending);
            }

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(generationConfig, buildNodeResponseMessages({ ...context, prompt }), (text) => {
                        streamed = text;
                        setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                    }, { signal: controller.signal });
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const video = await generateVideoResult(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], controller.signal);
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await generateAudioResult(generationConfig, prompt, controller.signal, retryTask);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    if (retryTask) {
                        useProviderTaskStore.getState().markWritten(retryTask.pendingId);
                        setNodeTaskMetadata(setNodes, node.id, retryTask.pendingId, TaskStatus.Written);
                    }
                    return;
                }

                const image = await generateImageResult(generationConfig, prompt, useReferenceImages ? retryImages : [], controller.signal, retryTask);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? { ...item, type: CanvasNodeType.Image, width: imageSize.width, height: imageSize.height, metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata } }
                            : item,
                    ),
                );
                if (retryTask) {
                    useProviderTaskStore.getState().markWritten(retryTask.pendingId);
                    setNodeTaskMetadata(setNodes, node.id, retryTask.pendingId, TaskStatus.Written);
                }
            } catch (error) {
                if (isCanvasGenerationCanceled(error)) {
                    if (retryTask) setNodeTaskMetadata(setNodes, node.id, retryTask.pendingId, TaskStatus.Cancelled);
                    return;
                }
                const errorDetails = generationErrorMessage(error);
                if (retryTask) setNodeTaskMetadata(setNodes, node.id, retryTask.pendingId, TaskStatus.Failed);
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startGenerationRequest],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                { x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2, y: sourceNode.position.y + sourceNode.height / 2 },
                { prompt: "", model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    return { runningNodeId, setRunningNodeId, startGenerationRequest, finishGenerationRequest, abortGenerationForNodeIds, confirmStopGeneration, handleGenerateNode, handleRetryNode, generateImageFromTextNode };
}