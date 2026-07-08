import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { isLongTermMemoryItem, type CanvasProject, type DashboardCanvas } from "../types";
import ProjectAssetsPanel from "./ProjectAssetsPanel";
import { useProjectAssets } from "../hooks/useProjectAssets";
import {
  ASSET_ACCENT_STROKE,
  collectProjectTreeIds,
  resolveRootProjectId,
  type ProjectAsset,
  type ProjectAssetAccent,
} from "../lib/projectAssets";

const TREE_WORLD_WIDTH = 1800;
const TREE_WORLD_HEIGHT = 1100;
const TREE_START_X = 250;
const TREE_DEPTH_GAP = 360;
const TREE_ROW_GAP = 116;
const FOLDER_NODE = { width: 250, height: 82 };
const CANVAS_NODE = { width: 238, height: 76 };
const TREE_EXPANSION_STORAGE_KEY = "intellidraw.dashboard.folderTree.expandedFolders";

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

type AssetLineGeometry = {
  key: string;
  assetId: string;
  accent: ProjectAssetAccent;
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

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
  const worldRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const panStart = useRef<{ pointerId: number; x: number; y: number; pan: PointerPoint } | null>(null);
  const pinchStart = useRef<{ distance: number; zoom: number; pan: PointerPoint; center: PointerPoint } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => loadExpandedFolders(rootProject.id));

  // ── Project Assets (local-only prototype): read-only relationship view ──
  const [showAssets, setShowAssets] = useState(false);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const assetRowRefs = useRef(new Map<string, HTMLElement>());
  const [assetLineGeometry, setAssetLineGeometry] = useState<AssetLineGeometry[]>([]);

  // Assets are shared across the whole ROOT project tree — the folder shown
  // here may itself be a subfolder, so walk up to the true root first.
  const assetRootId = useMemo(
    () => resolveRootProjectId(rootProject.id, [...folders, rootProject]),
    [rootProject, folders],
  );
  const assetTreeIds = useMemo(
    () => collectProjectTreeIds(assetRootId, folders),
    [assetRootId, folders],
  );
  const assetScopes = useMemo(() => [assetRootId], [assetRootId]);

  const projectAssets = useProjectAssets(assetScopes, { enabled: showAssets });
  const canvasTitles = useMemo(
    () => new Map(canvases.map((canvas) => [canvas.id, canvas.title])),
    [canvases],
  );
  const assetFolderOptions = useMemo(() => {
    const options = folders
      .filter((folder) => assetTreeIds.has(folder.id))
      .map((folder) => ({ id: folder.id, title: folder.title }));
    if (!options.some((option) => option.id === rootProject.id) && assetTreeIds.has(rootProject.id)) {
      options.unshift({ id: rootProject.id, title: rootProject.title });
    }
    return options;
  }, [folders, assetTreeIds, rootProject.id, rootProject.title]);
  const assetCanvasOptions = useMemo(
    () => canvases
      .filter((canvas) => canvas.project_id && assetTreeIds.has(canvas.project_id))
      .map((canvas) => ({ id: canvas.id, title: canvas.title })),
    [canvases, assetTreeIds],
  );

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

  useEffect(() => {
    saveExpandedFolders(rootProject.id, expandedFolders);
  }, [expandedFolders, rootProject.id]);

  const canvasLinkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of projectAssets.links) {
      counts.set(link.canvasId, (counts.get(link.canvasId) ?? 0) + 1);
    }
    return counts;
  }, [projectAssets.links]);

  // One line per asset↔canvas pair, with the number of node links it bundles.
  const assetCanvasPairs = useMemo(() => {
    const accentById = new Map(projectAssets.assets.map((asset) => [asset.id, asset.accent]));
    const pairs = new Map<string, { assetId: string; canvasId: string; count: number; accent: ProjectAssetAccent }>();
    for (const link of projectAssets.links) {
      const accent = accentById.get(link.assetId);
      if (!accent) continue;
      const key = `${link.assetId}:${link.canvasId}`;
      const existing = pairs.get(key);
      if (existing) existing.count += 1;
      else pairs.set(key, { assetId: link.assetId, canvasId: link.canvasId, count: 1, accent });
    }
    return Array.from(pairs.entries()).map(([key, pair]) => ({ key, ...pair }));
  }, [projectAssets.assets, projectAssets.links]);

  const [assetMeasureTick, setAssetMeasureTick] = useState(0);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !showAssets) return;
    const observer = new ResizeObserver(() => setAssetMeasureTick((tick) => tick + 1));
    observer.observe(tree);
    return () => observer.disconnect();
  }, [showAssets]);

  useLayoutEffect(() => {
    const tree = treeRef.current;
    const world = worldRef.current;
    if (!showAssets || !tree || !world) {
      setAssetLineGeometry([]);
      return;
    }

    const treeRect = tree.getBoundingClientRect();
    const worldRect = world.getBoundingClientRect();
    const canvasNodesById = new Map(
      layout.children.filter((item) => item.kind === "canvas").map((item) => [item.id, item]),
    );

    const nextGeometry: AssetLineGeometry[] = [];
    for (const pair of assetCanvasPairs) {
      const rowElement = assetRowRefs.current.get(pair.assetId);
      const node = canvasNodesById.get(pair.canvasId);
      if (!rowElement || !node) continue;
      const rowRect = rowElement.getBoundingClientRect();
      nextGeometry.push({
        key: pair.key,
        assetId: pair.assetId,
        accent: pair.accent,
        count: pair.count,
        x1: rowRect.left - treeRect.left,
        y1: rowRect.top + rowRect.height / 2 - treeRect.top,
        x2: worldRect.left - treeRect.left + (node.x + CANVAS_NODE.width) * zoom,
        y2: worldRect.top - treeRect.top + (node.y + CANVAS_NODE.height / 2) * zoom,
      });
    }
    setAssetLineGeometry(nextGeometry);
  }, [showAssets, assetCanvasPairs, layout, pan, zoom, assetMeasureTick]);

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
        <button
          type="button"
          className={showAssets ? "is-selected" : ""}
          onClick={() => setShowAssets((current) => !current)}
          aria-label="Project assets"
          aria-pressed={showAssets}
          title="Project assets"
        >
          <span className="material-symbols-outlined">hub</span>
        </button>
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
          ref={worldRef}
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
            <CanvasTreeNode
              key={node.key}
              node={node}
              onOpen={() => onOpenCanvas(node.id)}
              assetLinkCount={showAssets ? canvasLinkCounts.get(node.id) ?? 0 : 0}
            />
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

      {/* Asset-to-canvas connection lines (screen space, hidden when panel closed) */}
      {showAssets && assetLineGeometry.length > 0 && (
        <svg className="absolute inset-0 w-full h-full z-[6] overflow-visible pointer-events-none" aria-hidden="true">
          {assetLineGeometry.map((line) => {
            const stroke = ASSET_ACCENT_STROKE[line.accent];
            const bend = Math.max(60, Math.abs(line.x1 - line.x2) * 0.42);
            const isHighlighted = hoveredAssetId === line.assetId;
            return (
              <g key={line.key} opacity={hoveredAssetId && !isHighlighted ? 0.25 : 1}>
                <path
                  d={`M ${line.x1} ${line.y1} C ${line.x1 - bend} ${line.y1}, ${line.x2 + bend} ${line.y2}, ${line.x2} ${line.y2}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHighlighted ? 3.5 : 2}
                  strokeLinecap="round"
                  opacity={0.9}
                  style={{ transition: "stroke-width 160ms ease" }}
                />
                <circle cx={line.x2} cy={line.y2} r={4} fill={stroke} />
                <circle cx={line.x1} cy={line.y1} r={3.5} fill={stroke} />
                {line.count > 1 && (
                  <g transform={`translate(${(line.x1 + line.x2) / 2}, ${(line.y1 + line.y2) / 2})`}>
                    <circle r={9} fill="#ffffff" stroke={stroke} strokeWidth={1.5} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={800} fill={stroke}>
                      {line.count}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* Project Assets panel (read-only in the tree view; link on the canvas) */}
      {showAssets && (
        <div className="absolute right-3 top-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex">
          <ProjectAssetsPanel
            variant="dashboard"
            className="w-full max-h-full"
            assets={projectAssets.assets}
            links={projectAssets.links}
            loading={projectAssets.loading}
            notice={projectAssets.error}
            onDismissNotice={projectAssets.clearError}
            canvasTitles={canvasTitles}
            canvasOptions={assetCanvasOptions}
            folderOptions={assetFolderOptions}
            onRegisterAsset={projectAssets.registerAsset}
            onUpdateAsset={projectAssets.updateAsset}
            onOpenAssetTarget={(asset: ProjectAsset) => {
              if (!asset.targetId) return;
              if (asset.type === "canvas") onOpenCanvas(asset.targetId);
              else onOpenFolder(asset.targetId);
            }}
            onRemoveAsset={projectAssets.removeAsset}
            onRemoveLink={projectAssets.removeLink}
            onToggleLinkStatus={projectAssets.toggleLinkStatus}
            onClose={() => setShowAssets(false)}
            registerRowRef={(assetId, element) => {
              if (element) assetRowRefs.current.set(assetId, element);
              else assetRowRefs.current.delete(assetId);
            }}
            onHoverAsset={setHoveredAssetId}
          />
        </div>
      )}
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

function CanvasTreeNode({
  node,
  onOpen,
  assetLinkCount = 0,
}: {
  node: Extract<TreeItem, { kind: "canvas" }>;
  onOpen: () => void;
  assetLinkCount?: number;
}) {
  return (
    <button
      type="button"
      className="dashboard-tree-node dashboard-tree-canvas"
      style={{ left: node.x, top: node.y, width: CANVAS_NODE.width, height: CANVAS_NODE.height }}
      onClick={onOpen}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="dashboard-tree-node-port input" aria-hidden="true" />
      {assetLinkCount > 0 && (
        <span className="dashboard-tree-asset-badge" title={`${assetLinkCount} linked asset node${assetLinkCount === 1 ? "" : "s"}`}>
          <span className="material-symbols-outlined" aria-hidden="true">link</span>
          {assetLinkCount}
        </span>
      )}
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

function loadExpandedFolders(rootProjectId: string) {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const stored = window.localStorage.getItem(TREE_EXPANSION_STORAGE_KEY);
    if (!stored) return new Set<string>();
    const parsed = JSON.parse(stored);
    if (!isExpansionStorage(parsed)) return new Set<string>();
    return new Set(parsed[rootProjectId] ?? []);
  } catch {
    return new Set<string>();
  }
}

function saveExpandedFolders(rootProjectId: string, expandedFolders: Set<string>) {
  if (typeof window === "undefined") return;

  try {
    const stored = window.localStorage.getItem(TREE_EXPANSION_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    const next = isExpansionStorage(parsed) ? parsed : {};
    const folderIds = Array.from(expandedFolders);

    if (folderIds.length === 0) delete next[rootProjectId];
    else next[rootProjectId] = folderIds;

    window.localStorage.setItem(TREE_EXPANSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is best-effort; the tree still works normally without it.
  }
}

function isExpansionStorage(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => (
    Array.isArray(entry) && entry.every((item) => typeof item === "string")
  ));
}
