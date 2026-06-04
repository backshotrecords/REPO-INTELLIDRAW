import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import type { CanvasProject, DashboardCanvas } from "../types";

const TREE_WORLD_WIDTH = 1800;
const TREE_WORLD_HEIGHT = 1100;
const FOLDER_NODE = { width: 250, height: 82 };
const CANVAS_NODE = { width: 238, height: 76 };

type TreeItem =
  | {
      id: string;
      kind: "folder";
      title: string;
      accent: CanvasProject["accent"];
      canvasCount: number;
      folderCount: number;
      updatedLabel: string;
      x: number;
      y: number;
    }
  | {
      id: string;
      kind: "canvas";
      title: string;
      isPublic: boolean;
      updatedLabel: string;
      x: number;
      y: number;
    };

type PointerPoint = { x: number; y: number };

export default function DashboardCanvasTreeView({
  rootProject,
  folders,
  canvases,
  projectCanvasCounts,
  projectFolderCounts,
  onOpenFolder,
  onOpenCanvas,
}: {
  rootProject: CanvasProject;
  folders: CanvasProject[];
  canvases: DashboardCanvas[];
  projectCanvasCounts: Map<string, number>;
  projectFolderCounts: Map<string, number>;
  onOpenFolder: (projectId: string) => void;
  onOpenCanvas: (canvasId: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const panStart = useRef<{ pointerId: number; x: number; y: number; pan: PointerPoint } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number; pan: PointerPoint; center: PointerPoint } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);

  const layout = useMemo(() => {
    const root: TreeItem = {
      id: rootProject.id,
      kind: "folder",
      title: rootProject.title,
      accent: rootProject.accent,
      canvasCount: projectCanvasCounts.get(rootProject.id) ?? 0,
      folderCount: projectFolderCounts.get(rootProject.id) ?? 0,
      updatedLabel: formatTreeDate(rootProject.updated_at),
      x: 250,
      y: 500,
    };

    const children: TreeItem[] = [
      ...folders.map((folder) => ({
        id: folder.id,
        kind: "folder" as const,
        title: folder.title,
        accent: folder.accent,
        canvasCount: projectCanvasCounts.get(folder.id) ?? 0,
        folderCount: projectFolderCounts.get(folder.id) ?? 0,
        updatedLabel: formatTreeDate(folder.updated_at),
        x: 0,
        y: 0,
      })),
      ...canvases.map((canvas) => ({
        id: canvas.id,
        kind: "canvas" as const,
        title: canvas.title,
        isPublic: canvas.is_public,
        updatedLabel: formatTreeDate(canvas.updated_at),
        x: 0,
        y: 0,
      })),
    ];

    const columns = chunkItems(children, 5);
    const placedChildren = columns.flatMap((column, columnIndex) => {
      const x = 650 + columnIndex * 340;
      const rowGap = 112;
      const yStart = 500 - ((column.length - 1) * rowGap) / 2;
      return column.map((item, rowIndex) => ({
        ...item,
        x,
        y: yStart + rowIndex * rowGap,
      }));
    });

    return { root, children: placedChildren };
  }, [canvases, folders, projectCanvasCounts, projectFolderCounts, rootProject]);

  const edges = useMemo(() => layout.children.map((child) => ({
    id: `${layout.root.id}-${child.id}`,
    from: getOutputPoint(layout.root),
    to: getInputPoint(child),
  })), [layout]);

  function clampZoom(value: number) {
    return Math.min(1.9, Math.max(0.42, value));
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number) {
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
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const nextZoom = clampZoom(zoom * (1 - Math.max(-60, Math.min(60, event.deltaY)) * 0.006));
      zoomAt(event.clientX, event.clientY, nextZoom);
      return;
    }
    setPan((current) => ({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  }

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

  return (
    <section className="dashboard-tree-view" aria-label={`${rootProject.title} canvas tree`}>
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
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="dashboard-tree-world"
          style={{
            width: TREE_WORLD_WIDTH,
            height: TREE_WORLD_HEIGHT,
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg className="dashboard-tree-connectors" viewBox={`0 0 ${TREE_WORLD_WIDTH} ${TREE_WORLD_HEIGHT}`} aria-hidden="true">
            {edges.map((edge) => (
              <path key={edge.id} d={connectorPath(edge.from, edge.to)} />
            ))}
          </svg>

          <FolderTreeNode node={layout.root} isRoot onOpen={() => onOpenFolder(layout.root.id)} />
          {layout.children.map((node) => node.kind === "folder" ? (
            <FolderTreeNode key={node.id} node={node} onOpen={() => onOpenFolder(node.id)} />
          ) : (
            <CanvasTreeNode key={node.id} node={node} onOpen={() => onOpenCanvas(node.id)} />
          ))}

          {layout.children.length === 0 && (
            <div className="dashboard-tree-empty-node" style={{ left: 650, top: 480 }}>
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

function FolderTreeNode({ node, isRoot, onOpen }: { node: Extract<TreeItem, { kind: "folder" }>; isRoot?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`dashboard-tree-node dashboard-tree-folder project-${node.accent}${isRoot ? " is-root" : ""}`}
      style={{ left: node.x, top: node.y, width: FOLDER_NODE.width, height: FOLDER_NODE.height }}
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="dashboard-tree-node-port output" aria-hidden="true" />
      {!isRoot && <span className="dashboard-tree-node-port input" aria-hidden="true" />}
      <span className="dashboard-tree-folder-icon">
        <span className="material-symbols-outlined fill">folder</span>
      </span>
      <span className="dashboard-tree-node-copy">
        <strong title={node.title}>{node.title}</strong>
        <small>{node.canvasCount} canvases · {node.folderCount} folders</small>
        <small>Modified {node.updatedLabel}</small>
      </span>
      <span className="material-symbols-outlined dashboard-tree-node-open" aria-hidden="true">chevron_right</span>
    </button>
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

function chunkItems<T>(items: T[], maxItems: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += maxItems) {
    chunks.push(items.slice(index, index + maxItems));
  }
  return chunks;
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
