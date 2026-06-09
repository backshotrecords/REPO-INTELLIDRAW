import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { isLongTermMemoryItem, type CanvasProject, type DashboardCanvas } from "../types";

const TREE_WORLD_WIDTH = 1800;
const TREE_WORLD_HEIGHT = 1100;
const TREE_START_X = 250;
const TREE_DEPTH_GAP = 360;
const TREE_ROW_GAP = 116;
const FOLDER_NODE = { width: 250, height: 82 };
const CANVAS_NODE = { width: 238, height: 76 };

type TreeItem =
  | {
      key: string;
      id: string;
      kind: "folder";
      title: string;
      accent: CanvasProject["accent"];
      canvasCount: number;
      folderCount: number;
      childCount: number;
      expanded: boolean;
      updatedLabel: string;
      x: number;
      y: number;
    }
  | {
      key: string;
      id: string;
      kind: "canvas";
      title: string;
      isPublic: boolean;
      updatedLabel: string;
      x: number;
      y: number;
    };

type PointerPoint = { x: number; y: number };
type TreeEdge = { id: string; from: PointerPoint; to: PointerPoint };

export default function DashboardCanvasTreeView({
  rootProject,
  folders,
  canvases,
  archiveOnly,
  search,
  onOpenFolder,
  onOpenCanvas,
}: {
  rootProject: CanvasProject;
  folders: CanvasProject[];
  canvases: DashboardCanvas[];
  archiveOnly: boolean;
  search: string;
  onOpenFolder: (projectId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
}) {
  const treeRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const panStart = useRef<{ pointerId: number; x: number; y: number; pan: PointerPoint } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number; pan: PointerPoint; center: PointerPoint } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const layout = useMemo(() => {
    const depthColumns = new Map<number, TreeItem[]>();
    const edgePairs: Array<{ id: string; parentKey: string; childKey: string }> = [];
    const normalizedSearch = search.trim().toLowerCase();

    const childFoldersFor = (projectId: string) => folders.filter((folder) => (
      folder.parent_project_id === projectId
      && matchesTreeFilter(folder, archiveOnly, normalizedSearch)
    ));
    const childCanvasesFor = (projectId: string) => canvases.filter((canvas) => (
      canvas.project_id === projectId
      && matchesTreeFilter(canvas, archiveOnly, normalizedSearch)
    ));

    function addToColumn(depth: number, item: TreeItem) {
      const column = depthColumns.get(depth) ?? [];
      column.push(item);
      depthColumns.set(depth, column);
    }

    function makeFolderNode(folder: CanvasProject, isRoot = false): Extract<TreeItem, { kind: "folder" }> {
      const childFolders = childFoldersFor(folder.id);
      const childCanvases = childCanvasesFor(folder.id);
      const childCount = childFolders.length + childCanvases.length;
      return {
        key: `folder:${folder.id}`,
        id: folder.id,
        kind: "folder",
        title: folder.title,
        accent: folder.accent,
        canvasCount: childCanvases.length,
        folderCount: childFolders.length,
        childCount,
        expanded: isRoot || expandedFolders.has(folder.id),
        updatedLabel: formatTreeDate(folder.updated_at),
        x: 0,
        y: 0,
      };
    }

    function addFolder(folder: CanvasProject, depth: number, parentKey?: string, isRoot = false) {
      const node = makeFolderNode(folder, isRoot);
      addToColumn(depth, node);
      if (parentKey) edgePairs.push({ id: `${parentKey}-${node.key}`, parentKey, childKey: node.key });
      if (!node.expanded) return;

      for (const childFolder of childFoldersFor(folder.id)) addFolder(childFolder, depth + 1, node.key);
      for (const canvas of childCanvasesFor(folder.id)) addCanvas(canvas, depth + 1, node.key);
    }

    function addCanvas(canvas: DashboardCanvas, depth: number, parentKey: string) {
      const node: Extract<TreeItem, { kind: "canvas" }> = {
        key: `canvas:${canvas.id}`,
        id: canvas.id,
        kind: "canvas",
        title: canvas.title,
        isPublic: canvas.is_public,
        updatedLabel: formatTreeDate(canvas.updated_at),
        x: 0,
        y: 0,
      };
      addToColumn(depth, node);
      edgePairs.push({ id: `${parentKey}-${node.key}`, parentKey, childKey: node.key });
    }

    addFolder(rootProject, 0, undefined, true);

    const maxDepth = Math.max(0, ...depthColumns.keys());
    const maxColumnCount = Math.max(1, ...Array.from(depthColumns.values()).map((column) => column.length));
    const worldWidth = Math.max(TREE_WORLD_WIDTH, TREE_START_X + maxDepth * TREE_DEPTH_GAP + 620);
    const worldHeight = Math.max(TREE_WORLD_HEIGHT, maxColumnCount * TREE_ROW_GAP + 240);
    const centerY = worldHeight / 2;
    const placedItems: TreeItem[] = [];

    for (const [depth, column] of depthColumns.entries()) {
      const x = TREE_START_X + depth * TREE_DEPTH_GAP;
      const yStart = centerY - ((column.length - 1) * TREE_ROW_GAP) / 2;
      column.forEach((item, index) => {
        item.x = x;
        item.y = yStart + index * TREE_ROW_GAP;
        placedItems.push(item);
      });
    }

    const byKey = new Map(placedItems.map((item) => [item.key, item]));
    const root = byKey.get(`folder:${rootProject.id}`) as Extract<TreeItem, { kind: "folder" }>;
    const edges: TreeEdge[] = edgePairs.flatMap((edge) => {
      const parent = byKey.get(edge.parentKey);
      const child = byKey.get(edge.childKey);
      return parent && child ? [{ id: edge.id, from: getOutputPoint(parent), to: getInputPoint(child) }] : [];
    });

    return {
      root,
      children: placedItems.filter((item) => item.key !== root.key),
      edges,
      worldWidth,
      worldHeight,
    };
  }, [archiveOnly, canvases, expandedFolders, folders, rootProject, search]);

  const clampZoom = useCallback((value: number) => {
    return Math.min(1.9, Math.max(0.42, value));
  }, []);

  const zoomAt = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setZoom(nextZoom);
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const local = {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
    setPan((currentPan) => {
      const world = {
        x: (local.x - currentPan.x) / zoom,
        y: (local.y - currentPan.y) / zoom,
      };
      return {
        x: local.x - world.x * nextZoom,
        y: local.y - world.y * nextZoom,
      };
    });
    setZoom(nextZoom);
  }, [zoom]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      const nextZoom = clampZoom(zoom * (1 - Math.max(-60, Math.min(60, event.deltaY)) * 0.006));
      zoomAt(event.clientX, event.clientY, nextZoom);
      return;
    }
    setPan((current) => ({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  }, [clampZoom, zoom, zoomAt]);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;

    tree.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => tree.removeEventListener("wheel", handleWheel, { capture: true });
  }, [handleWheel]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setIsInteracting(true);

    if (activePointers.current.size === 1) {
      panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan };
      pinchStart.current = null;
      return;
    }

    if (activePointers.current.size === 2) {
      const points = Array.from(activePointers.current.values());
      pinchStart.current = {
        distance: getDistance(points[0], points[1]),
        zoom,
        pan,
        center: getMidpoint(points[0], points[1]),
      };
      panStart.current = null;
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(event.pointerId)) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.current.size === 2 && pinchStart.current) {
      const points = Array.from(activePointers.current.values());
      const nextDistance = getDistance(points[0], points[1]);
      const nextCenter = getMidpoint(points[0], points[1]);
      const nextZoom = clampZoom(pinchStart.current.zoom * (nextDistance / Math.max(1, pinchStart.current.distance)));
      const centerDelta = {
        x: nextCenter.x - pinchStart.current.center.x,
        y: nextCenter.y - pinchStart.current.center.y,
      };
      setZoom(nextZoom);
      setPan({
        x: pinchStart.current.pan.x + centerDelta.x,
        y: pinchStart.current.pan.y + centerDelta.y,
      });
      return;
    }

    if (panStart.current?.pointerId === event.pointerId) {
      setPan({
        x: panStart.current.pan.x + event.clientX - panStart.current.x,
        y: panStart.current.pan.y + event.clientY - panStart.current.y,
      });
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released after a browser gesture.
    }
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size === 0) {
      setIsInteracting(false);
      panStart.current = null;
      pinchStart.current = null;
    }
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function toggleExpandedFolder(folderId: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  return (
    <section ref={treeRef} className="dashboard-tree-view" aria-label={`${rootProject.title} canvas tree`}>
      <div className="dashboard-tree-controls" aria-label="Canvas tree zoom controls">
        <button type="button" onClick={() => setZoom((current) => clampZoom(current + 0.14))} aria-label="Zoom in">
          <span className="material-symbols-outlined">zoom_in</span>
        </button>
        <button type="button" onClick={() => setZoom((current) => clampZoom(current - 0.14))} aria-label="Zoom out">
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
        <button type="button" onClick={resetView} aria-label="Reset view">
          <span className="material-symbols-outlined">center_focus_strong</span>
        </button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>

      <div
        ref={viewportRef}
        className={`dashboard-tree-viewport${isInteracting ? " is-interacting" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="dashboard-tree-world"
          style={{
            width: layout.worldWidth,
            height: layout.worldHeight,
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg className="dashboard-tree-connectors" viewBox={`0 0 ${layout.worldWidth} ${layout.worldHeight}`} aria-hidden="true">
            {layout.edges.map((edge) => (
              <path key={edge.id} d={connectorPath(edge.from, edge.to)} />
            ))}
          </svg>

          <FolderTreeNode node={layout.root} isRoot onOpen={() => onOpenFolder(layout.root.id)} />
          {layout.children.map((node) => node.kind === "folder" ? (
            <FolderTreeNode key={node.key} node={node} onOpen={() => onOpenFolder(node.id)} onToggleExpand={() => toggleExpandedFolder(node.id)} />
          ) : (
            <CanvasTreeNode key={node.key} node={node} onOpen={() => onOpenCanvas(node.id)} />
          ))}

          {layout.children.length === 0 && (
            <div className="dashboard-tree-empty-node" style={{ left: TREE_START_X + TREE_DEPTH_GAP, top: layout.worldHeight / 2 - 41 }}>
              <span className="material-symbols-outlined">inbox</span>
              <strong>No items in this view</strong>
              <small>Switch memory state or create a canvas here.</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FolderTreeNode({
  node,
  isRoot,
  onOpen,
  onToggleExpand,
}: {
  node: Extract<TreeItem, { kind: "folder" }>;
  isRoot?: boolean;
  onOpen: () => void;
  onToggleExpand?: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`dashboard-tree-node dashboard-tree-folder project-${node.accent}${isRoot ? " is-root" : ""}`}
      style={{ left: node.x, top: node.y, width: FOLDER_NODE.width, height: FOLDER_NODE.height }}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {node.childCount > 0 && <span className="dashboard-tree-node-port output" aria-hidden="true" />}
      {!isRoot && <span className="dashboard-tree-node-port input" aria-hidden="true" />}
      <span className="dashboard-tree-folder-icon">
        <span className="material-symbols-outlined fill">folder</span>
      </span>
      <span className="dashboard-tree-node-copy">
        <strong title={node.title}>{node.title}</strong>
        <small>{node.canvasCount} canvases · {node.folderCount} folders</small>
        <small>Modified {node.updatedLabel}</small>
      </span>
      {!isRoot && node.childCount > 0 ? (
        <button
          type="button"
          className={`dashboard-tree-expand-button${node.expanded ? " is-expanded" : ""}`}
          aria-label={`${node.expanded ? "Collapse" : "Expand"} ${node.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand?.();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="material-symbols-outlined" aria-hidden="true">{node.expanded ? "remove" : "add"}</span>
        </button>
      ) : (
        <span className="material-symbols-outlined dashboard-tree-node-open" aria-hidden="true">chevron_right</span>
      )}
    </div>
  );
}

function CanvasTreeNode({ node, onOpen }: { node: Extract<TreeItem, { kind: "canvas" }>; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="dashboard-tree-node dashboard-tree-canvas"
      style={{ left: node.x, top: node.y, width: CANVAS_NODE.width, height: CANVAS_NODE.height }}
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="dashboard-tree-node-port input" aria-hidden="true" />
      <span className="dashboard-tree-canvas-icon">
        <span className="material-symbols-outlined">account_tree</span>
      </span>
      <span className="dashboard-tree-node-copy">
        <strong title={node.title}>{node.title}</strong>
        <small>{node.isPublic ? "Public canvas" : "Private canvas"}</small>
        <small>Modified {node.updatedLabel}</small>
      </span>
      <span className="material-symbols-outlined dashboard-tree-node-open" aria-hidden="true">open_in_new</span>
    </button>
  );
}

function getInputPoint(node: TreeItem) {
  const size = node.kind === "folder" ? FOLDER_NODE : CANVAS_NODE;
  return { x: node.x, y: node.y + size.height / 2 };
}

function getOutputPoint(node: TreeItem) {
  const size = node.kind === "folder" ? FOLDER_NODE : CANVAS_NODE;
  return { x: node.x + size.width, y: node.y + size.height / 2 };
}

function connectorPath(from: PointerPoint, to: PointerPoint) {
  const curve = Math.max(120, Math.abs(to.x - from.x) * 0.48);
  return `M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`;
}

function getDistance(a: PointerPoint, b: PointerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getMidpoint(a: PointerPoint, b: PointerPoint) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function formatTreeDate(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function matchesTreeFilter(item: CanvasProject | DashboardCanvas, archiveOnly: boolean, normalizedSearch: string) {
  if (archiveOnly ? !isLongTermMemoryItem(item) : isLongTermMemoryItem(item)) return false;
  if (!normalizedSearch) return true;
  return item.title.toLowerCase().includes(normalizedSearch);
}
