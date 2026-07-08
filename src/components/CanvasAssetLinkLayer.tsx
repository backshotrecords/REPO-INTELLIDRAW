import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { extractNodeId } from "./MermaidRenderer";
import {
  ASSET_ACCENT_STROKE,
  type ProjectAsset,
  type ProjectAssetLink,
} from "../lib/projectAssets";

interface CanvasAssetLinkLayerProps {
  canvasAreaRef: RefObject<HTMLDivElement | null>;
  /** Links already filtered to the open canvas. */
  links: ProjectAssetLink[];
  assets: ProjectAsset[];
  armedAssetId: string | null;
  hoveredAssetId: string | null;
  /** Panel row elements keyed by asset id, registered by ProjectAssetsPanel. */
  rowRefs: RefObject<Map<string, HTMLElement>>;
  pan: { x: number; y: number };
  zoom: number;
  diagramCode: string;
  onToggleNodeLink: (nodeId: string) => void;
  onRemoveLink: (link: ProjectAssetLink) => void;
}

interface LinkGeometry {
  key: string;
  link: ProjectAssetLink | null;
  accent: ProjectAsset["accent"];
  isPreview: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const TAP_MOVE_THRESHOLD_PX = 8;

function findNodeElements(canvasArea: HTMLElement): Map<string, Element> {
  const byNodeId = new Map<string, Element>();
  canvasArea.querySelectorAll(".node").forEach((element) => {
    const nodeId = extractNodeId(element.id || "");
    if (nodeId && !byNodeId.has(nodeId)) byNodeId.set(nodeId, element);
  });
  return byNodeId;
}

// Bounding-rect hit-test (matches WorkspacePage): mermaid renders labels as
// HTML inside <foreignObject>, so closest(".node") can't cross the SVG
// namespace boundary from the label element.
function nodeIdFromPoint(canvasArea: HTMLElement, clientX: number, clientY: number): string | null {
  for (const element of canvasArea.querySelectorAll(".node")) {
    const rect = element.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return extractNodeId(element.id || "");
    }
  }
  return null;
}

function linkPath(geometry: LinkGeometry) {
  const bend = Math.max(60, Math.abs(geometry.x1 - geometry.x2) * 0.42);
  return `M ${geometry.x1} ${geometry.y1} C ${geometry.x1 - bend} ${geometry.y1}, ${geometry.x2 + bend} ${geometry.y2}, ${geometry.x2} ${geometry.y2}`;
}

/**
 * Screen-space overlay that draws asset-to-node connections between the
 * Project Assets panel rows and rendered mermaid nodes. Both endpoints are
 * measured with getBoundingClientRect relative to the canvas area, so the
 * lines follow pan/zoom (state-driven re-measures) and diagram re-renders
 * (MutationObserver).
 */
export default function CanvasAssetLinkLayer({
  canvasAreaRef,
  links,
  assets,
  armedAssetId,
  hoveredAssetId,
  rowRefs,
  pan,
  zoom,
  diagramCode,
  onToggleNodeLink,
  onRemoveLink,
}: CanvasAssetLinkLayerProps) {
  const [geometry, setGeometry] = useState<LinkGeometry[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const pointerDownPosition = useRef<{ x: number; y: number } | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  const accentByAssetId = useRef(new Map<string, ProjectAsset["accent"]>());
  accentByAssetId.current = new Map(assets.map((asset) => [asset.id, asset.accent]));

  const measure = useCallback(() => {
    const canvasArea = canvasAreaRef.current;
    const rows = rowRefs.current;
    if (!canvasArea || !rows) {
      setGeometry([]);
      return;
    }

    const areaRect = canvasArea.getBoundingClientRect();
    const nodeElements = findNodeElements(canvasArea);
    const nextGeometry: LinkGeometry[] = [];

    const pushGeometry = (assetId: string, nodeId: string, link: ProjectAssetLink | null) => {
      const rowElement = rows.get(assetId);
      const nodeElement = nodeElements.get(nodeId);
      const accent = accentByAssetId.current.get(assetId);
      if (!rowElement || !nodeElement || !accent) return;

      const rowRect = rowElement.getBoundingClientRect();
      const nodeRect = nodeElement.getBoundingClientRect();

      nextGeometry.push({
        key: link ? link.id : `preview:${assetId}:${nodeId}`,
        link,
        accent,
        isPreview: !link,
        x1: rowRect.left - areaRect.left,
        y1: rowRect.top + rowRect.height / 2 - areaRect.top,
        x2: nodeRect.right - areaRect.left,
        y2: nodeRect.top + nodeRect.height / 2 - areaRect.top,
      });
    };

    for (const link of links) {
      pushGeometry(link.assetId, link.nodeId, link);
    }

    if (armedAssetId && hoveredNodeId) {
      const alreadyLinked = links.some(
        (link) => link.assetId === armedAssetId && link.nodeId === hoveredNodeId,
      );
      if (!alreadyLinked) pushGeometry(armedAssetId, hoveredNodeId, null);
    }

    setGeometry(nextGeometry);
  }, [canvasAreaRef, rowRefs, links, armedAssetId, hoveredNodeId]);

  const measureRef = useRef(measure);
  measureRef.current = measure;

  // Re-measure on state-driven changes; the pan/zoom transform animates for
  // ~100ms when not gesturing, so settle with a trailing pass.
  useLayoutEffect(() => {
    measure();
    const settleTimer = setTimeout(() => measureRef.current(), 140);
    return () => clearTimeout(settleTimer);
  }, [measure, pan.x, pan.y, zoom, diagramCode]);

  useEffect(() => {
    const canvasArea = canvasAreaRef.current;
    if (!canvasArea) return;

    const remeasure = () => requestAnimationFrame(() => measureRef.current());
    const resizeObserver = new ResizeObserver(remeasure);
    resizeObserver.observe(canvasArea);
    const mutationObserver = new MutationObserver(remeasure);
    mutationObserver.observe(canvasArea, { childList: true, subtree: true });
    window.addEventListener("resize", remeasure);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [canvasAreaRef]);

  // While an asset is armed, node taps become link toggles. We intercept at
  // pointerdown (capture phase) so the workspace's pan/selection handler never
  // starts tracking that pointer — background drags still pan normally.
  useEffect(() => {
    const canvasArea = canvasAreaRef.current;
    if (!canvasArea || !armedAssetId) {
      setHoveredNodeId(null);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest("[data-assets-panel]")) return;
      const nodeId = nodeIdFromPoint(canvasArea, event.clientX, event.clientY);
      if (!nodeId) {
        pointerDownPosition.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pointerDownPosition.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerDownPosition.current;
      if (!start) return;
      pointerDownPosition.current = null;
      event.preventDefault();
      event.stopPropagation();
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_MOVE_THRESHOLD_PX) return;

      const nodeId = nodeIdFromPoint(canvasArea, event.clientX, event.clientY);
      if (nodeId) onToggleNodeLink(nodeId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (hoverRafRef.current !== null) return;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        setHoveredNodeId(nodeIdFromPoint(canvasArea, event.clientX, event.clientY));
      });
    };

    canvasArea.addEventListener("pointerdown", handlePointerDown, { capture: true });
    canvasArea.addEventListener("pointerup", handlePointerUp, { capture: true });
    canvasArea.addEventListener("pointermove", handlePointerMove, { capture: true });

    return () => {
      canvasArea.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      canvasArea.removeEventListener("pointerup", handlePointerUp, { capture: true });
      canvasArea.removeEventListener("pointermove", handlePointerMove, { capture: true });
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    };
  }, [armedAssetId, canvasAreaRef, onToggleNodeLink]);

  if (geometry.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 w-full h-full z-30 overflow-visible"
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      {geometry.map((item) => {
        const stroke = ASSET_ACCENT_STROKE[item.accent];
        const isPending = item.link?.status === "pending";
        const isHighlighted = hoveredAssetId != null && item.link?.assetId === hoveredAssetId;

        return (
          <g key={item.key}>
            <path
              d={linkPath(item)}
              fill="none"
              stroke={stroke}
              strokeWidth={isHighlighted ? 3.5 : 2}
              strokeLinecap="round"
              strokeDasharray={item.isPreview ? "4 7" : isPending ? "6 6" : undefined}
              opacity={item.isPreview ? 0.55 : isPending ? 0.72 : 0.9}
              style={{
                pointerEvents: item.isPreview || armedAssetId ? "none" : "stroke",
                cursor: "pointer",
                transition: "stroke-width 160ms ease, opacity 160ms ease",
              }}
              onClick={() => {
                if (item.link) onRemoveLink(item.link);
              }}
            >
              {!item.isPreview && <title>Click to unlink</title>}
            </path>
            <circle cx={item.x2} cy={item.y2} r={4} fill={stroke} />
            <circle cx={item.x1} cy={item.y1} r={3.5} fill={stroke} />
          </g>
        );
      })}
    </svg>
  );
}
