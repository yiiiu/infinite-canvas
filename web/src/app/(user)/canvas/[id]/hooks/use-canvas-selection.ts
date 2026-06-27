import { useCallback, useEffect, useState, useRef } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type ContextMenuState, type Position, type SelectionBox, type ViewportTransform } from "../../types";
import type { PendingConnectionCreate } from "./use-canvas-connections";
import { isHiddenBatchChild } from "../../utils/canvas-node-config";
import { computeConnectionPathD } from "../../components/canvas-connections";

type Params = {
    selectedNodeIds: Set<string>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
    selectionBox: SelectionBox | null;
    setSelectionBox: Dispatch<SetStateAction<SelectionBox | null>>;
    selectedNodeIdsRef: { current: Set<string> };
    selectionBoxRef: { current: SelectionBox | null };
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    historyPausedRef: { current: boolean };
    nodeDraggingRef: { current: boolean };
    viewportRef: { current: ViewportTransform };
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setMouseWorld: Dispatch<SetStateAction<Position>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setEditingNodeId: Dispatch<SetStateAction<string | null>>;
    keepNodeToolbar: (nodeId: string) => void;
    // forward refs updated after connections hook
    cancelPendingConnectionCreateRef: { current: () => void };
    connectingParamsRef: { current: ConnectionHandle | null };
    pendingConnectionCreateRef: { current: PendingConnectionCreate | null };
    connectionTargetNodeIdRef: { current: string | null };
    setConnectionTargetNodeId: Dispatch<SetStateAction<string | null>>;
    getConnectionDropTargetRef: { current: (x: number, y: number, handle: ConnectionHandle) => { nodeId: string | null; isNearNode: boolean } };
    connectNodesRef: { current: (handle: ConnectionHandle, targetId: string) => void };
    setConnecting: (next: ConnectionHandle | null) => void;
    setPendingConnectionCreate: Dispatch<SetStateAction<PendingConnectionCreate | null>>;
};

export function useCanvasSelection({
    selectedNodeIds,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setHoveredNodeId,
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
}: Params) {
    const [isNodeDragging, setIsNodeDragging] = useState(false);

    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
    }>({ isDraggingNode: false, hasMoved: false, startX: 0, startY: 0, initialSelectedNodes: [] });
    const rafRef = useRef<number | null>(null);
    const draggingElementsRef = useRef<Array<{ el: HTMLElement; initialX: number; initialY: number }>>([]);
    const draggingConnectionsRef = useRef<
        Array<{
            pathEls: HTMLElement[];
            fromNode: { id: string; initialX: number; initialY: number; width: number; height: number; isDragged: boolean };
            toNode: { id: string; initialX: number; initialY: number; width: number; height: number; isDragged: boolean };
        }>
    >([]);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreateRef.current();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, []);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreateRef.current();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
        },
        [screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        setContextMenu(null);
        setHoveredNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };

        // Collect DOM references for direct manipulation during drag
        draggingElementsRef.current = dragRef.current.initialSelectedNodes
            .map(({ id, x, y }) => {
                const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
                return el ? { el, initialX: x, initialY: y } : null;
            })
            .filter(Boolean) as Array<{ el: HTMLElement; initialX: number; initialY: number }>;

        // Collect connection DOM references for direct path updates during drag
        const draggedIds = new Set(dragRef.current.initialSelectedNodes.map((n) => n.id));
        const allNodes = currentNodes;
        const involvedConnections = connectionsRef.current.filter((c) => draggedIds.has(c.fromNodeId) || draggedIds.has(c.toNodeId));

        draggingConnectionsRef.current = involvedConnections
            .map((conn) => {
                const from = allNodes.find((n) => n.id === conn.fromNodeId);
                const to = allNodes.find((n) => n.id === conn.toNodeId);
                if (!from || !to) return null;

                const pathEls = Array.from(document.querySelectorAll<HTMLElement>(`[data-connection-id="${conn.id}"]`));
                if (!pathEls.length) return null;

                return {
                    pathEls,
                    fromNode: {
                        id: from.id,
                        initialX: from.position.x,
                        initialY: from.position.y,
                        width: from.width,
                        height: from.height,
                        isDragged: draggedIds.has(from.id),
                    },
                    toNode: {
                        id: to.id,
                        initialX: to.position.x,
                        initialY: to.position.y,
                        width: to.width,
                        height: to.height,
                        isDragged: draggedIds.has(to.id),
                    },
                };
            })
            .filter(Boolean) as typeof draggingConnectionsRef.current;

        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / viewportRef.current.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / viewportRef.current.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);

        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        draggingElementsRef.current = [];
        draggingConnectionsRef.current = [];

        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            keepNodeToolbar(clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            if (dragRef.current.isDraggingNode) {
                const { k } = viewportRef.current;
                const dx = (event.clientX - dragRef.current.startX) / k;
                const dy = (event.clientY - dragRef.current.startY) / k;

                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                // Direct DOM manipulation - bypass React entirely during drag
                for (const { el, initialX, initialY } of draggingElementsRef.current) {
                    el.style.transform = `translate(${initialX + dx}px, ${initialY + dy}px)`;
                }

                // Update connection paths directly during drag
                for (const { pathEls, fromNode, toNode } of draggingConnectionsRef.current) {
                    const fromPos = {
                        x: fromNode.initialX + (fromNode.isDragged ? dx : 0),
                        y: fromNode.initialY + (fromNode.isDragged ? dy : 0),
                    };
                    const toPos = {
                        x: toNode.initialX + (toNode.isDragged ? dx : 0),
                        y: toNode.initialY + (toNode.isDragged ? dy : 0),
                    };

                    const d = computeConnectionPathD(
                        { position: fromPos, width: fromNode.width, height: fromNode.height },
                        { position: toPos, width: toNode.width, height: toNode.height },
                    );

                    for (const el of pathEls) {
                        el.setAttribute("d", d);
                    }
                }
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTargetRef.current(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;
                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTargetRef.current(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodesRef.current(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [finishNodeDrag, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    return { isNodeDragging, deselectCanvas, handleCanvasMouseDown, handleNodeMouseDown, finishNodeDrag };
}