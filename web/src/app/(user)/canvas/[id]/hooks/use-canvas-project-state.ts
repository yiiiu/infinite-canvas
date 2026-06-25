import { useEffect, useState } from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useCanvasStore, type CanvasProject } from "../../stores/use-canvas-store";
import { hydrateAssistantImages, hydrateCanvasImages, resetInterruptedGeneration } from "../../utils/canvas-generation-helpers";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../../types";

export type RestoredCanvasProjectState = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type UseCanvasProjectStateParams = {
    projectId: string;
    historyPausedRef: { current: boolean };
    onMissingProject: () => void;
    onViewportRestore: (viewport: ViewportTransform) => void;
    onProjectRestored: (entry: RestoredCanvasProjectState) => void;
};

export function useCanvasProjectState({ projectId, historyPausedRef, onMissingProject, onViewportRestore, onProjectRestored }: UseCanvasProjectStateParams) {
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const projectCount = useCanvasStore((state) => state.projects.length);
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);

    useEffect(() => {
        if (!hydrated) return;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            onMissingProject();
            return;
        }

        const restore = async () => {
            const restoredNodes = await hydrateCanvasImages(resetInterruptedGeneration(project.nodes));
            const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
            const restoredState: RestoredCanvasProjectState = {
                nodes: restoredNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            setNodes(restoredState.nodes);
            setConnections(restoredState.connections);
            setChatSessions(restoredState.chatSessions);
            setActiveChatId(restoredState.activeChatId);
            setBackgroundMode(restoredState.backgroundMode);
            setShowImageInfo(restoredState.showImageInfo);
            onViewportRestore(project.viewport);
            onProjectRestored(restoredState);
            setProjectLoaded(true);
        };
        void restore();
    }, [hydrated, onMissingProject, onProjectRestored, onViewportRestore, openProject, projectId]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, historyPausedRef, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    return {
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
        currentProject: currentProject as CanvasProject | undefined,
        projectCount,
        createProject,
        updateProject,
        renameProject,
        deleteProjects,
    };
}