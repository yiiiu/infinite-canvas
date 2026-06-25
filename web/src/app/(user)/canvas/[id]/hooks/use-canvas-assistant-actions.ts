import { useCallback, useEffect, useRef, useState } from "react";

import { readImageMeta } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { CANVAS_AGENT_PANEL_MOTION_MS } from "../../components/canvas-assistant-panel";
import type { CanvasAgentMode } from "../../components/canvas-agent-chat-ui";
import { fitNodeSize } from "../../utils/canvas-node-size";
import { createCanvasNode, imageMetadata } from "../../utils/canvas-node-config";
import { CanvasNodeType, type CanvasAssistantImage, type CanvasAssistantSession, type CanvasNodeData } from "../../types";

const NODE_STATUS_SUCCESS = "success" as const;

type Params = any;

export function useCanvasAssistantActions(params: Params) {
    const {
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
    } = params;

    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [agentMode, setAgentMode] = useState<CanvasAgentMode>("online");
    const agentModeRef = useRef(agentMode);
    const agentCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const codexAutoConnect = ["new", "recent", "choose"].includes(searchParams.get("mode") || "");
    const codexCompactAgent = codexAutoConnect && searchParams.has("agentUrl");
    const assistantOpen = assistantMounted && !assistantCollapsed;

    useEffect(() => {
        agentModeRef.current = agentMode;
    }, [agentMode]);

    const openAgent = useCallback((mode?: CanvasAgentMode) => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAgentMode(mode || agentModeRef.current);
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    }, []);

    const closeAgent = useCallback(() => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    }, [assistantClosing, assistantMounted]);

    useEffect(() => {
        if (!projectLoaded || !codexAutoConnect) return;
        if (searchParams.has("agentUrl")) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [codexAutoConnect, openAgent, projectLoaded, searchParams]);

    useEffect(
        () => () => {
            if (agentCloseTimerRef.current) clearTimeout(agentCloseTimerRef.current);
        },
        [],
    );

    const canvasCenter = useCallback(() => screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2), [containerRef, screenToCanvas, size.height, size.width]);

    const pasteAssistantImage = useCallback(
        (file: File) => {
            void createImageFileNode(file, canvasCenter());
            message.success("已从剪切板添加图片");
        },
        [canvasCenter, createImageFileNode, message],
    );

    const handleAssistantSessionsChange = useCallback(
        (sessions: CanvasAssistantSession[], activeId: string | null) => {
            setChatSessions(sessions);
            setActiveChatId(activeId);
        },
        [setActiveChatId, setChatSessions],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = canvasCenter();
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev: CanvasNodeData[]) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [canvasCenter, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = canvasCenter();
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev: CanvasNodeData[]) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [canvasCenter, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    return {
        assistantMounted,
        assistantClosing,
        assistantOpen,
        agentMode,
        setAgentMode,
        codexAutoConnect,
        codexCompactAgent,
        openAgent,
        closeAgent,
        pasteAssistantImage,
        handleAssistantSessionsChange,
        insertAssistantImage,
        insertAssistantText,
    };
}