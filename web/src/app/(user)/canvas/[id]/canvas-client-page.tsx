"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Bot, Boxes, Home, ImageIcon, Images, List, Menu, MousePointer2, Music2, Plus, Redo2, ServerCog, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";

import { DOCS_URL } from "@/constant/env";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { canvasThemes } from "@/lib/canvas-theme";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { SettingsModal } from "@/components/settings/settings-modal";
import { DefaultsSettingsSection } from "@/components/settings/sections/defaults-section";
import { ProviderSettingsSection } from "@/components/settings/sections/provider-section";
import type { SettingsSection } from "@/components/settings/types";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { App, Button, Dropdown, Modal } from "antd";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CanvasAssistantPanel } from "../components/canvas-assistant-panel";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { CanvasNodeAngleDialog } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog } from "../components/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog } from "../components/canvas-node-upscale-dialog";
import { buildNodeGenerationInputs, type NodeGenerationInput } from "../components/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { InfiniteCanvas } from "../components/infinite-canvas";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasAppearanceSettingsSection } from "../components/canvas-appearance-settings-section";
import { AssetPickerModal } from "../components/asset-picker-modal";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { CanvasLocalAgentPanel } from "../components/canvas-local-agent-panel";
import { useCanvasAgentStore } from "../stores/use-canvas-agent-store";
import { type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "../utils/canvas-resource-references";
import { createCanvasNode, isHiddenBatchChild, isHiddenBatchConnectionEndpoint } from "../utils/canvas-node-config";
import { getGenerationCount, getInputSummary } from "../utils/canvas-generation-helpers";
import { normalizeConnection } from "../utils/canvas-connection-helpers";
import { useCanvasViewport } from "./hooks/use-canvas-viewport";
import { useCanvasOverlays } from "./hooks/use-canvas-overlays";
import { useCanvasProjectState, type RestoredCanvasProjectState } from "./hooks/use-canvas-project-state";
import { useCanvasHistory, type CanvasHistoryEntry } from "./hooks/use-canvas-history";
import { useCanvasConnections, type PendingConnectionCreate } from "./hooks/use-canvas-connections";
import { useCanvasSelection } from "./hooks/use-canvas-selection";
import { useCanvasGeneration } from "./hooks/use-canvas-generation";
import { useCanvasNodeActions } from "./hooks/use-canvas-node-actions";
import { useCanvasAssistantActions } from "./hooks/use-canvas-assistant-actions";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasVideoTaskType, type ConnectionHandle, type Position, type SelectionBox, type ViewportTransform } from "../types";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function ConnectionCreateMenu({
    pending,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    引用该节点生成
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title="文本生成" description="脚本、广告词、品牌文案" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title="配置节点" description="模型、尺寸、数量和输入顺序" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const searchParams = useSearchParams();
    const projectId = params.id;
    const localAgentConnected = useCanvasAgentStore((state) => state.connected);
    const localAgentActivity = useCanvasAgentStore((state) => state.activity);
    const localAgentEnabled = useCanvasAgentStore((state) => state.enabled);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyPausedRef = useRef(false);
    const nodeDraggingRef = useRef(false);
    const restoreViewportRef = useRef<(viewport: ViewportTransform) => void>(() => {});
    const [settingsOpen, setSettingsOpen] = useState(false);

    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const {
        contextMenu,
        setContextMenu,
        isMiniMapOpen,
        setIsMiniMapOpen,
        clearConfirmOpen,
        setClearConfirmOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        toolbarNodeId,
        setToolbarNodeId,
        nodeImageSettingsOpen,
        setNodeImageSettingsOpen,
        dialogNodeId,
        setDialogNodeId,
        editingNodeId,
        setEditingNodeId,
        editRequestNonce,
        setEditRequestNonce,
        infoNodeId,
        setInfoNodeId,
        cropNodeId,
        setCropNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        superResolveNodeId,
        setSuperResolveNodeId,
        angleNodeId,
        setAngleNodeId,
        previewNodeId,
        setPreviewNodeId,
        keepNodeToolbar,
        hideNodeToolbar,
    } = useCanvasOverlays({ nodeDraggingRef });
    const resetHistoryRef = useRef<(entry: CanvasHistoryEntry) => void>(() => {});
    const handleMissingProject = useCallback(() => {
        router.replace("/canvas");
    }, [router]);
    const restoreProjectViewport = useCallback((nextViewport: ViewportTransform) => {
        restoreViewportRef.current(nextViewport);
    }, []);
    const handleProjectRestored = useCallback((entry: RestoredCanvasProjectState) => {
        resetHistoryRef.current(entry);
    }, []);
    const {
        nodes,
        setNodes,
        connections,
        setConnections,
        chatSessions,
        setChatSessions,
        activeChatId,
        setActiveChatId,
        backgroundMode,
        setBackgroundMode,
        showImageInfo,
        setShowImageInfo,
        projectLoaded,
        currentProject,
        projectCount,
        createProject,
        updateProject,
        renameProject,
        deleteProjects,
    } = useCanvasProjectState({
        projectId,
        historyPausedRef,
        onMissingProject: handleMissingProject,
        onViewportRestore: restoreProjectViewport,
        onProjectRestored: handleProjectRestored,
    });
    const saveViewport = useCallback((id: string, nextViewport: ViewportTransform) => updateProject(id, { viewport: nextViewport }), [updateProject]);
    const closeViewportOverlay = useCallback(() => setContextMenu(null), []);
    const { viewport, setViewport, viewportRef, size, mouseWorld, setMouseWorld, screenToCanvas, getCanvasCenter, resetViewport, setZoomScale } = useCanvasViewport({
        containerRef,
        projectId,
        projectLoaded,
        onViewportSave: saveViewport,
        onViewportAction: closeViewportOverlay,
    });
    restoreViewportRef.current = setViewport;
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);

    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [referencePickTargetNodeId, setReferencePickTargetNodeId] = useState<string | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const canvasSettingsSections = useMemo<SettingsSection[]>(
        () => [
            {
                id: "canvas-general",
                title: "常规",
                icon: <Settings2 className="size-4" />,
                component: () => <CanvasAppearanceSettingsSection backgroundMode={backgroundMode} showImageInfo={showImageInfo} onBackgroundModeChange={setBackgroundMode} onShowImageInfoChange={setShowImageInfo} />,
            },
            { id: "providers", title: "AI 服务商", icon: <ServerCog className="size-4" />, component: ProviderSettingsSection },
            { id: "defaults", title: "默认模型", icon: <Boxes className="size-4" />, component: DefaultsSettingsSection },
        ],
        [backgroundMode, setBackgroundMode, setShowImageInfo, showImageInfo],
    );
    const selectedNodeIdsRef = useRef<Set<string>>(new Set());
    const selectionBoxRef = useRef<SelectionBox | null>(null);

    // forward refs filled after useCanvasConnections
    const cancelPendingConnectionCreateRef = useRef<() => void>(() => {});
    const getConnectionDropTargetRef = useRef<(x: number, y: number, handle: ConnectionHandle) => { nodeId: string | null; isNearNode: boolean }>(() => ({ nodeId: null, isNearNode: false }));
    const connectNodesRef = useRef<(handle: ConnectionHandle, targetId: string) => void>(() => {});

    const { historyRef, lastHistoryRef, applyingHistoryRef, historyState, agentUndoSnapshot, setAgentUndoSnapshot, createHistoryEntry, cleanupCanvasFiles, applyHistory, undoCanvas, redoCanvas, applyAgentOps, undoAgentOps, resetHistory } =
        useCanvasHistory({
            projectLoaded,
            projectId,
            currentProject,
            historyPausedRef,
            nodes,
            connections,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
            nodesRef,
            connectionsRef,
            selectedNodeIdsRef,
            viewportRef,
            generateNodeRef,
            setNodes,
            setConnections,
            setChatSessions,
            setActiveChatId,
            setBackgroundMode,
            setShowImageInfo,
            setSelectedNodeIds,
            setSelectedConnectionId,
            setViewport,
            setContextMenu,
            cleanupAssetImages,
        });
    resetHistoryRef.current = resetHistory;

    const {
        connectingParams,
        connectionTargetNodeId,
        pendingConnectionCreate,
        connectingParamsRef,
        connectionTargetNodeIdRef,
        pendingConnectionCreateRef,
        setPendingConnectionCreate,
        setConnectionTargetNodeId,
        setConnecting,
        connectNodes,
        cancelPendingConnectionCreate,
        getConnectionDropTarget,
        deleteConnection,
        handleConnectStart,
    } = useCanvasConnections({
        nodesRef,
        connectionsRef,
        setConnections,
        setContextMenu,
        setSelectedConnectionId,
        setMouseWorld,
        screenToCanvas,
        viewportRef,
        message,
    });

    cancelPendingConnectionCreateRef.current = cancelPendingConnectionCreate;
    getConnectionDropTargetRef.current = getConnectionDropTarget;
    connectNodesRef.current = connectNodes;

    const { isNodeDragging, deselectCanvas, handleCanvasMouseDown, handleNodeMouseDown } = useCanvasSelection({
        selectedNodeIds,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setHoveredNodeId,
        selectionBox,
        setSelectionBox,
        selectedNodeIdsRef,
        selectionBoxRef,
        nodesRef,
        connectionsRef,
        setNodes,
        historyPausedRef,
        nodeDraggingRef,
        viewportRef,
        screenToCanvas,
        setMouseWorld,
        setContextMenu,
        setToolbarNodeId,
        setDialogNodeId,
        setEditingNodeId,
        keepNodeToolbar,
        cancelPendingConnectionCreateRef,
        connectingParamsRef,
        pendingConnectionCreateRef,
        connectionTargetNodeIdRef,
        setConnectionTargetNodeId,
        getConnectionDropTargetRef,
        connectNodesRef,
        setConnecting,
        setPendingConnectionCreate,
    });

    const { runningNodeId, setRunningNodeId, startGenerationRequest, finishGenerationRequest, abortGenerationForNodeIds, confirmStopGeneration, handleGenerateNode, handleRetryNode, generateImageFromTextNode } = useCanvasGeneration({
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
    });

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
    }, [nodes, connections, selectedNodeIds]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const addImageReferenceConnection = useCallback(
        (targetNodeId: string, sourceNodeId: string) => {
            if (targetNodeId === sourceNodeId) return;
            const source = nodesRef.current.find((node) => node.id === sourceNodeId);
            const target = nodesRef.current.find((node) => node.id === targetNodeId);
            if (!source || !target || !isReferencePickTargetNode(target) || !isReferencePickSourceNode(source, target)) return;
            const exists = connectionsRef.current.some((connection) => connection.fromNodeId === sourceNodeId && connection.toNodeId === targetNodeId);
            if (exists) return;
            const targetVideoTaskType = normalizeCanvasVideoTaskType(target.metadata?.videoTaskType);
            if (target.type === CanvasNodeType.Video && targetVideoTaskType === "first-last-frame") {
                if (source.type !== CanvasNodeType.Image) return;
                const imageReferenceCount = countImageReferenceConnections(targetNodeId, nodesRef.current, connectionsRef.current);
                if (imageReferenceCount >= 2) {
                    message.warning("首尾帧模式最多添加两张参考图");
                    return;
                }
            }
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: sourceNodeId, toNodeId: targetNodeId }]);
            if (target.type === CanvasNodeType.Video && source.type === CanvasNodeType.Image && targetVideoTaskType !== "first-last-frame") {
                setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, metadata: { ...node.metadata, videoTaskType: "i2v" } } : node)));
            }
        },
        [message, setConnections, setNodes],
    );

    const removeImageReferenceConnection = useCallback(
        (targetNodeId: string, sourceNodeId: string) => {
            const connection = connectionsRef.current.find((item) => item.fromNodeId === sourceNodeId && item.toNodeId === targetNodeId);
            if (connection) deleteConnection(connection.id);
        },
        [deleteConnection],
    );

    const locateReferencePickTargetNode = useCallback(() => {
        const targetNodeId = referencePickTargetNodeId;
        const node = targetNodeId ? nodesRef.current.find((item) => item.id === targetNodeId) : null;
        if (!node) return;
        const scale = viewportRef.current.k;
        setViewport({
            x: size.width / 2 - (node.position.x + node.width / 2) * scale,
            y: size.height / 2 - (node.position.y + node.height / 2) * scale,
            k: scale,
        });
        setSelectedNodeIds(new Set([node.id]));
        setDialogNodeId(node.id);
        setSelectedConnectionId(null);
        setContextMenu(null);
    }, [referencePickTargetNodeId, setContextMenu, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds, setViewport, size.height, size.width, viewportRef]);

    const visibleNodes = useMemo(() => {
        const padding = 1500;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, nodes, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const referencePickTargetNode = referencePickTargetNodeId ? nodeById.get(referencePickTargetNodeId) || null : null;
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;

    useEffect(() => {
        if (!referencePickTargetNodeId) return;
        const targetNode = nodesRef.current.find((node) => node.id === referencePickTargetNodeId);
        if (!targetNode || !isReferencePickTargetNode(targetNode)) setReferencePickTargetNodeId(null);
    }, [nodes, referencePickTargetNodeId]);

    useEffect(() => {
        if (!referencePickTargetNodeId) return;
        const handleReferencePickKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setReferencePickTargetNodeId(null);
        };
        window.addEventListener("keydown", handleReferencePickKeyDown);
        return () => window.removeEventListener("keydown", handleReferencePickKeyDown);
    }, [referencePickTargetNodeId]);

    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const referencePickSourceNodeIds = useMemo(() => {
        if (!referencePickTargetNodeId) return new Set<string>();
        return new Set(connections.filter((connection) => connection.toNodeId === referencePickTargetNodeId).map((connection) => connection.fromNodeId));
    }, [connections, referencePickTargetNodeId]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProject?.title || "未命名画布", nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProject?.title, nodes, projectId, selectedNodeIds, viewport],
    );
    const {
        createNode,
        deleteNodes,
        clearCanvas,
        duplicateNode,
        createImageFileNode,
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
    } = useCanvasNodeActions({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        projectId,
        chatSessions,
        selectedConnectionId,
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
    });

    const { assistantMounted, assistantClosing, assistantOpen, agentMode, setAgentMode, codexAutoConnect, codexCompactAgent, openAgent, closeAgent, pasteAssistantImage, handleAssistantSessionsChange } = useCanvasAssistantActions({
        searchParams,
        projectLoaded,
        containerRef,
        size,
        screenToCanvas,
        createImageFileNode,
        setChatSessions,
        setActiveChatId,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        message,
    });

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`无限画布 ${projectCount + 1}`);
        router.push(`/canvas/${id}`);
    }, [createProject, projectCount, router]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        router.push("/canvas");
    }, [cleanupAssetImages, deleteProjects, projectId, router]);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleImageSettingsOpenChange = useCallback((open: boolean) => {
        setNodeImageSettingsOpen(open);
        if (open) setToolbarNodeId(null);
    }, []);

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() => router.push("/")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={assistantOpen}
                    compactAgentStatus={codexCompactAgent ? { connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity } : undefined}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                    onOpenSettings={() => setSettingsOpen(true)}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id || (referencePickTargetNode !== null && hoveredNodeId === node.id && node.id !== referencePickTargetNode.id && isReferencePickSourceNode(node, referencePickTargetNode))}
                            connectionTargetPoint={connectionTargetNodeId === node.id ? mouseWorld : undefined}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            referencePickLabel={referencePickTargetNode && node.id !== referencePickTargetNode.id && isReferencePickSourceNode(node, referencePickTargetNode) ? (referencePickSourceNodeIds.has(node.id) ? "取消参考" : "选择为参考") : undefined}
                            renderPanel={(panelNode) =>
                                panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        referencePicking={referencePickTargetNodeId === panelNode.id}
                                        onStartReferencePick={(nodeId) => setReferencePickTargetNodeId((current) => (current === nodeId ? null : nodeId))}
                                        onRemoveReference={removeImageReferenceConnection}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onProviderOverrideChange={handleProviderOverrideChange}
                                        onGenerate={handleGenerateNode}
                                        onStop={confirmStopGeneration}
                                        onImageSettingsOpenChange={handleImageSettingsOpenChange}
                                    />
                                )
                            }
                            renderNodeContent={(contentNode) => (
                                <CanvasConfigNodePanel
                                    node={contentNode}
                                    isRunning={runningNodeId === contentNode.id}
                                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                    onConfigChange={handleConfigNodeChange}
                                    onProviderOverrideChange={handleProviderOverrideChange}
                                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                                    onStop={confirmStopGeneration}
                                    onGenerate={(nodeId) => {
                                        const target = nodesRef.current.find((item) => item.id === nodeId);
                                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                                    }}
                                />
                            )}
                            onMouseDown={(event, nodeId) => {
                                const targetNodeId = referencePickTargetNodeId;
                                const targetNode = targetNodeId ? nodesRef.current.find((item) => item.id === targetNodeId) : null;
                                const clickedNode = nodesRef.current.find((item) => item.id === nodeId);
                                if (targetNodeId && targetNode && clickedNode && clickedNode.id !== targetNodeId && isReferencePickSourceNode(clickedNode, targetNode)) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (referencePickSourceNodeIds.has(nodeId)) {
                                        removeImageReferenceConnection(targetNodeId, nodeId);
                                    } else {
                                        addImageReferenceConnection(targetNodeId, nodeId);
                                    }
                                    return;
                                }
                                handleNodeMouseDown(event, nodeId);
                            }}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node) => void handleRetryNode(node)}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onContextMenu={(event, id) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                </InfiniteCanvas>

                {referencePickTargetNodeId ? <CanvasReferencePickBanner onLocateTarget={locateReferencePickTargetNode} onExit={() => setReferencePickTargetNodeId(null)} /> : null}

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen || referencePickTargetNodeId ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                    onOpenSettings={() => setSettingsOpen(true)}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
                <SettingsModal open={settingsOpen} sections={canvasSettingsSections} onOpenChange={setSettingsOpen} />
                {codexCompactAgent && !assistantMounted ? <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={Boolean(agentUndoSnapshot)} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} /> : null}
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onApplyOps={applyAgentOps}
                    canUndoOps={Boolean(agentUndoSnapshot)}
                    onUndoOps={undoAgentOps}
                    onPasteImage={pasteAssistantImage}
                    agentMode={agentMode}
                    onAgentModeChange={setAgentMode}
                    autoConnectLocal={codexAutoConnect}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                />
            ) : null}
        </main>
    );
}

function CanvasReferencePickBanner({ onLocateTarget, onExit }: { onLocateTarget: () => void; onExit: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[80] -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-[20px] border p-2 shadow-2xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                <span className="grid size-10 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                    <MousePointer2 className="size-5" />
                </span>
                <span className="px-2 text-base font-semibold whitespace-nowrap">从画布选择参考</span>
                <button type="button" className="h-10 rounded-xl px-4 text-sm font-medium transition" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }} onClick={onLocateTarget}>
                    定位节点
                </button>
                <button type="button" className="h-10 rounded-xl px-4 text-sm font-medium transition" style={{ background: theme.node.text, color: theme.canvas.background }} onClick={onExit}>
                    退出
                </button>
            </div>
        </div>
    );
}

function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
    onOpenSettings,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus?: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
    onOpenSettings: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between px-4">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: "主页", onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "文档", onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex items-center gap-1.5">
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    <UserStatusActions variant="canvas" onOpenSettings={onOpenSettings} onOpenShortcuts={() => setShortcutsOpen(true)} />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["空格 + 左键拖动"]} value="平移视图" />
                    <Shortcut keys={["鼠标中键拖动"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "已连接到本地 Codex" : status.enabled ? status.activity || "连接中" : "正在连接本地 Codex";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-85"
            style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
            onClick={onClick}
            title="打开本地 Codex 面板"
        >
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[180px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}

function isReferencePickTargetNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video;
}

function isReferencePickSourceNode(source: CanvasNodeData, target: CanvasNodeData) {
    if (target.type === CanvasNodeType.Image) return source.type === CanvasNodeType.Image && Boolean(source.metadata?.content);
    if (target.type === CanvasNodeType.Video && normalizeCanvasVideoTaskType(target.metadata?.videoTaskType) === "first-last-frame") return source.type === CanvasNodeType.Image && Boolean(source.metadata?.content);
    if (target.type === CanvasNodeType.Video) return isReferenceResourceNode(source);
    return false;
}

function isReferenceResourceNode(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) return Boolean(node.metadata?.content);
    if (node.type === CanvasNodeType.Text) return Boolean(node.metadata?.content || node.metadata?.prompt);
    return false;
}

function normalizeCanvasVideoTaskType(value: unknown): CanvasVideoTaskType {
    return value === "i2v" || value === "first-last-frame" ? value : "t2v";
}

function countImageReferenceConnections(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return connections.filter((connection) => connection.toNodeId === targetNodeId && nodeById.get(connection.fromNodeId)?.type === CanvasNodeType.Image).length;
}
