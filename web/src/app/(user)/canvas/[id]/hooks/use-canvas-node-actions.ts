import { useCallback, useEffect } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent } from "react";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { requestEdit } from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";
import { getDataUrlByteSize } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { useProviderConfigStore, type ProviderConfigCapability, type ProviderModelSelection } from "@/providers/config";
import { useProviderTaskStore } from "@/providers/task-store";
import { NODE_DEFAULT_SIZE } from "../../constants";
import type { CanvasImageAngleParams } from "../../components/canvas-node-angle-dialog";
import type { CanvasImageCropRect } from "../../components/canvas-node-crop-dialog";
import type { CanvasImageMaskEditPayload } from "../../components/canvas-node-mask-edit-dialog";
import type { CanvasImageSplitParams } from "../../components/canvas-node-split-dialog";
import type { CanvasImageUpscaleParams } from "../../components/canvas-node-upscale-dialog";
import type { InsertAssetPayload } from "../../components/asset-picker-modal";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "../../utils/canvas-image-data";
import { fitNodeSize } from "../../utils/canvas-node-size";
import {
    applyNodeConfigPatch,
    audioExtension,
    audioMetadata,
    buildAngleLabel,
    buildAnglePrompt,
    createCanvasNode,
    imageExtension,
    imageMetadata,
    isAudioFile,
    videoMetadata,
} from "../../utils/canvas-node-config";
import { buildGenerationConfig, buildImageGenerationMetadata, getGenerationCount, isGenerationCanceled } from "../../utils/canvas-generation-helpers";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "../../types";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_ERROR = "error" as const;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

function providerOverrideForNodeType(type: CanvasNodeType): ProviderModelSelection | undefined {
    if (type === CanvasNodeType.Image) return providerOverrideForCapability("image");
    if (type === CanvasNodeType.Video) return providerOverrideForCapability("video");
    if (type === CanvasNodeType.Audio) return providerOverrideForCapability("audio");
    if (type === CanvasNodeType.Text) return providerOverrideForCapability("text");
    return undefined;
}

function providerOverrideForCapability(capability: ProviderConfigCapability): ProviderModelSelection | undefined {
    const selection = useProviderConfigStore.getState().defaults[capability];
    const profileId = selection?.profileId?.trim();
    const modelId = selection?.modelId?.trim();
    return profileId && modelId ? { profileId, modelId } : undefined;
}

type Params = any;

export function useCanvasNodeActions(params: Params) {
    const {
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        projectId,
        chatSessions,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        clipboardRef,
        uploadTargetRef,
        imageInputRef,
        containerRef,
        size,
        screenToCanvas,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setHoveredNodeId,
        setToolbarNodeId,
        setDialogNodeId,
        setEditingNodeId,
        setEditRequestNonce,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setSplitNodeId,
        setUpscaleNodeId,
        setAngleNodeId,
        setPreviewNodeId,
        setRunningNodeId,
        setContextMenu,
        setClearConfirmOpen,
        setSelectionBox,
        setConnecting,
        setPendingConnectionCreate,
        setOpeningBatchIds,
        setCollapsingBatchIds,
        setAssetPickerOpen,
        cleanupCanvasFiles,
        deselectCanvas,
        deleteConnection,
        undoCanvas,
        redoCanvas,
        addAsset,
        message,
        startGenerationRequest,
        finishGenerationRequest,
        abortGenerationForNodeIds,
    } = params;

    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const providerOverride = providerOverrideForNodeType(type);
            const newNode = { ...createCanvasNode(type, targetPosition, configMetadata), ...(providerOverride ? { providerOverride } : {}) };

            setNodes((prev: CanvasNodeData[]) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node: CanvasNodeData) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            abortGenerationForNodeIds?.(allIds);
            allIds.forEach((id) => useProviderTaskStore.getState().clearNodeTasks(projectId, id));
            setNodes((prev: CanvasNodeData[]) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev: CanvasConnection[]) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current: string | null) => (current && allIds.has(current) ? null : current));
            setContextMenu((current: any) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node: CanvasNodeData) => !allIds.has(node.id)), chatSessions });
        },
        [abortGenerationForNodeIds, chatSessions, cleanupCanvasFiles, projectId],
    );

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node: CanvasNodeData) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = { ...source, id, title: `${source.title} Copy`, position: { x: source.position.x + 36, y: source.position.y + 36 } };

        setNodes((prev: CanvasNodeData[]) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current.filter((node: CanvasNodeData) => selectedIds.has(node.id)).map((node: CanvasNodeData) => ({ ...node, position: { ...node.position }, metadata: node.metadata ? { ...node.metadata } : undefined }));
        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection: CanvasConnection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection: CanvasConnection) => ({ ...connection })),
        } satisfies CanvasClipboard;
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current as CanvasClipboard | null;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({ left: Math.min(acc.left, node.position.x), top: Math.min(acc.top, node.position.y), right: Math.max(acc.right, node.position.x + node.width), bottom: Math.max(acc.bottom, node.position.y + node.height) }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return { ...node, id, title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`, position: { x: node.position.x + dx, y: node.position.y + dy }, metadata: node.metadata ? { ...node.metadata } : undefined };
        });
        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [{ ...connection, id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, fromNodeId, toNodeId }];
        });

        setNodes((prev: CanvasNodeData[]) => [...prev, ...nextNodes]);
        setConnections((prev: CanvasConnection[]) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const imageProviderOverride = providerOverrideForNodeType(CanvasNodeType.Image);
        const newNode: CanvasNodeData = { id, type: CanvasNodeType.Image, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, ...(imageProviderOverride ? { providerOverride: imageProviderOverride } : {}), metadata: imageMetadata(image) };

        setNodes((prev: CanvasNodeData[]) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const videoProviderOverride = providerOverrideForNodeType(CanvasNodeType.Video);
        setNodes((prev: CanvasNodeData[]) => [...prev, { id, type: CanvasNodeType.Video, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, ...(videoProviderOverride ? { providerOverride: videoProviderOverride } : {}), metadata: videoMetadata(video) }]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const audioProviderOverride = providerOverrideForNodeType(CanvasNodeType.Audio);
        setNodes((prev: CanvasNodeData[]) => [...prev, { id, type: CanvasNodeType.Audio, title: file.name, position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 }, width: spec.width, height: spec.height, ...(audioProviderOverride ? { providerOverride: audioProviderOverride } : {}), metadata: audioMetadata(audio) }]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, []);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;
            const providerOverride = providerOverrideForNodeType(CanvasNodeType.Text);
            const node = { ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }), ...(providerOverride ? { providerOverride } : {}), title: trimmed.slice(0, 32) || "剪切板文本" };
            setNodes((prev: CanvasNodeData[]) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;
        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            void createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }
        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom]")) return;
            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;
            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node: CanvasNodeData) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) void pasteSystemClipboard();
                return;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) deleteNodes(new Set(selectedNodeIdsRef.current));
                else if (params.selectedConnectionId) deleteConnection(params.selectedConnectionId);
            }
            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, params.selectedConnectionId, setConnecting, undoCanvas]);

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev: CanvasNodeData[]) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node: CanvasNodeData) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev: Set<string>) => new Set(prev).add(nodeId));
            window.setTimeout(() => setCollapsingBatchIds((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(nodeId);
                return next;
            }), 320);
        } else {
            setOpeningBatchIds((prev: Set<string>) => new Set(prev).add(nodeId));
            window.setTimeout(() => setOpeningBatchIds((prev: Set<string>) => {
                const next = new Set(prev);
                next.delete(nodeId);
                return next;
            }), 260);
        }
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } } : node)));
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev: CanvasNodeData[]) =>
            prev.map((node) =>
                node.id === rootId
                    ? { ...node, width: child.width, height: child.height, metadata: { ...node.metadata, content: child.metadata?.content, primaryImageId: child.id, naturalWidth: child.metadata?.naturalWidth, naturalHeight: child.metadata?.naturalHeight, freeResize: child.metadata?.freeResize } }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value: number) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const handleProviderOverrideChange = useCallback((nodeId: string, value: ProviderModelSelection) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, providerOverride: value } : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                addAsset({ kind: "video", title: node.metadata?.prompt?.slice(0, 24) || "画布视频", coverUrl: "", tags: [], source: "Canvas", data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" }, metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt } });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({ kind: "image", title: node.metadata?.prompt?.slice(0, 24) || "画布图片", coverUrl: node.metadata.content, tags: [], source: "Canvas", data: { dataUrl, storageKey: node.metadata.storageKey, width: node.metadata.naturalWidth || node.width, height: node.metadata.naturalHeight || node.height, bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl), mimeType: node.metadata.mimeType || "image/png" }, metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt } });
            message.success("已加入我的素材");
        },
        [addAsset, message],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }
            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = { ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }), title: "反推提示词" };
            const configNode = { ...createCanvasNode(CanvasNodeType.Config, { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY }, { generationMode: "text", model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel, count: 1, composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]` }), title: "反推提示词配置" };
            setNodes((prev: CanvasNodeData[]) => [...prev, textNode, configNode]);
            setConnections((prev: CanvasConnection[]) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = { id: childId, type: CanvasNodeType.Image, title: "Cropped Image", position: { x: node.position.x + node.width + 96, y: node.position.y }, width, height: width * (image.height / image.width), metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt } };
        setNodes((prev: CanvasNodeData[]) => [...prev, child]);
        setConnections((prev: CanvasConnection[]) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, []);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(pieces.map(async (piece) => {
                const image = await uploadImage(piece.dataUrl);
                const id = nanoid();
                return { id, type: CanvasNodeType.Image, title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`, position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) }, width: cellWidth, height: cellHeight, metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt } } satisfies CanvasNodeData;
            }));
            setNodes((prev: CanvasNodeData[]) => [...prev, ...childNodes]);
            setConnections((prev: CanvasConnection[]) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev: CanvasNodeData[]) => [...prev, { id: childId, type: CanvasNodeType.Image, title: userPrompt.slice(0, 32) || "局部编辑结果", position: { x: node.position.x + node.width + 96, y: node.position.y }, width: node.width, height: node.height, metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } }]);
            setConnections((prev: CanvasConnection[]) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev: CanvasNodeData[]) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev: CanvasNodeData[]) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
        if (!node.metadata?.content) return;
        setUpscaleNodeId(null);
        const upscaled = await upscaleDataUrl(node.metadata.content, params);
        const image = await uploadImage(upscaled);
        const size = fitNodeSize(image.width, image.height);
        const childId = nanoid();
        const child: CanvasNodeData = { id: childId, type: CanvasNodeType.Image, title: "Upscaled Image", position: { x: node.position.x + node.width + 96, y: node.position.y }, width: size.width, height: size.height, metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt } };
        setNodes((prev: CanvasNodeData[]) => [...prev, child]);
        setConnections((prev: CanvasConnection[]) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev: CanvasNodeData[]) => [...prev, { id: childId, type: CanvasNodeType.Image, title, position: { x: node.position.x + node.width + 96, y: node.position.y }, width: imageConfig.width, height: imageConfig.height, metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata } }]);
            setConnections((prev: CanvasConnection[]) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], undefined, { signal: controller.signal }).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev: CanvasNodeData[]) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev: CanvasNodeData[]) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, openConfigDialog, startGenerationRequest],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;
            if (target?.nodeId) {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Audio, title: file.name, position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 }, width: spec.width, height: spec.height, metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                if (file.type.startsWith("video/")) {
                    const video = await uploadMediaFile(file, "video");
                    const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev: CanvasNodeData[]) => prev.map((node) => (node.id === target.nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node)));
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                    uploadTargetRef.current = null;
                    event.target.value = "";
                    return;
                }
                const image = await uploadImage(file);
                const size = fitNodeSize(image.width, image.height);
                setNodes((prev: CanvasNodeData[]) =>
                    prev.map((node) =>
                        node.id === target.nodeId
                            ? { ...node, type: CanvasNodeType.Image, title: file.name, width: size.width, height: size.height, metadata: { ...node.metadata, ...imageMetadata(image), errorDetails: undefined, freeResize: false, isBatchRoot: undefined, batchRootId: undefined, batchChildIds: undefined, batchUsesReferenceImages: undefined, generationType: undefined, model: undefined, size: undefined, quality: undefined, count: undefined, references: undefined, primaryImageId: undefined, imageBatchExpanded: undefined } }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.nodeId]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.nodeId);
            } else {
                const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
            }
            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!file) return;
            const pos = screenToCanvas(event.clientX, event.clientY);
            void (isAudioFile(file) ? createAudioFileNode(file, pos) : file.type.startsWith("video/") ? createVideoFileNode(file, pos) : createImageFileNode(file, pos));
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            if (payload.kind === "text") {
                const node = { ...createCanvasNode(CanvasNodeType.Text, center, { content: payload.content, status: NODE_STATUS_SUCCESS }), title: payload.content.slice(0, 32) || "Assistant Text" };
                setNodes((prev: CanvasNodeData[]) => [...prev, node]);
                setSelectedNodeIds(new Set([node.id]));
                setSelectedConnectionId(null);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev: CanvasNodeData[]) => [...prev, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 }, width: nextSize.width, height: nextSize.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
                setSelectedNodeIds(new Set([id]));
            } else {
                const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const node: CanvasNodeData = { id, type: CanvasNodeType.Image, title: payload.title, position: { x: center.x - NODE_DEFAULT_SIZE[CanvasNodeType.Image].width / 2, y: center.y - NODE_DEFAULT_SIZE[CanvasNodeType.Image].height / 2 }, width: NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, height: NODE_DEFAULT_SIZE[CanvasNodeType.Image].height, metadata: { content: payload.dataUrl, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: undefined, naturalHeight: undefined } };
                setNodes((prev: CanvasNodeData[]) => [...prev, node]);
                setSelectedNodeIds(new Set([id]));
                setSelectedConnectionId(null);
                setDialogNodeId(id);
            }
            setAssetPickerOpen(false);
        },
        [screenToCanvas, size.height, size.width],
    );

    return {
        createNode,
        deleteNodes,
        clearCanvas,
        duplicateNode,
        createImageFileNode,
        createVideoFileNode,
        createAudioFileNode,
        pasteSystemClipboard,
        handleNodeResize,
        toggleNodeFreeResize,
        handleNodeContentChange,
        toggleBatchExpanded,
        setBatchPrimary,
        openTextEditor,
        handleNodePromptChange,
        handleConfigNodeChange,
        handleProviderOverrideChange,
        downloadNodeImage,
        saveNodeAsset,
        createImageReversePromptNodes,
        cropImageNode,
        splitImageNode,
        maskEditImageNode,
        upscaleImageNode,
        generateAngleNode,
        handleFontSizeChange,
        handleUploadRequest,
        handleImageInputChange,
        handleDrop,
        handleAssetInsert,
    };
}