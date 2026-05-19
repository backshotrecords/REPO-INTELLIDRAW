/**
 * SubgraphCollapseOverlay — renders floating expand/collapse toggles for subgraphs.
 *
 * After MermaidRenderer renders SVG, this component scans the canvas for expanded
 * `.cluster` elements and collapsed `.node-compound` elements, then positions a
 * floating toggle near each group.
 */
import { type RefObject, useEffect, useRef, useState, useCallback } from "react";
import { extractNodeId } from "./MermaidRenderer";
import type { MermaidAST } from "../utils/mermaidParser";

type ToggleMode = "expand" | "collapse";

interface TogglePosition {
  subgraphId: string;
  label: string;
  mode: ToggleMode;
  /** Position relative to the canvas container */
  x: number;
  y: number;
}

interface ToggleTarget {
  subgraphId: string;
  mode: ToggleMode;
  element: Element;
}

interface SubgraphCollapseOverlayProps {
  diagramLayerRef: RefObject<HTMLDivElement | null>;
  parsedAST: MermaidAST | null;
  collapsedSubgraphIds: Set<string>;
  onCollapse: (subgraphId: string) => void;
  onExpand: (subgraphId: string) => void;
  zoom: number;
  isPanning: boolean;
  /** Changes whenever the rendered SVG changes — triggers re-scan */
  filteredCode: string;
}

export default function SubgraphCollapseOverlay({
  diagramLayerRef,
  parsedAST,
  collapsedSubgraphIds,
  onCollapse,
  onExpand,
  zoom,
  isPanning,
  filteredCode,
}: SubgraphCollapseOverlayProps) {
  const [togglePositions, setTogglePositions] = useState<TogglePosition[]>([]);
  const [visibleToggleKey, setVisibleToggleKey] = useState<string | null>(null);
  const targetsRef = useRef<ToggleTarget[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const showToggle = useCallback((key: string) => {
    if (isPanning) return;
    setVisibleToggleKey(key);
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setVisibleToggleKey(null);
      idleTimerRef.current = null;
    }, 3000);
  }, [clearIdleTimer, isPanning]);

  const hideToggle = useCallback(() => {
    setVisibleToggleKey(null);
    clearIdleTimer();
  }, [clearIdleTimer]);

  /**
   * Build a reverse lookup: label text → subgraph ID.
   * Mermaid cluster labels contain the subgraph's display label, which we match
   * against our AST's subgraph labels to identify which cluster is which.
   */
  const scanSubgraphToggles = useCallback(() => {
    if (!diagramLayerRef.current || !parsedAST) {
      setTogglePositions([]);
      return;
    }

    const layerRect = diagramLayerRef.current.getBoundingClientRect();
    const positions: TogglePosition[] = [];
    const targets: ToggleTarget[] = [];

    const clusters = diagramLayerRef.current.querySelectorAll(".cluster");

    // Build label → subgraph ID map for expanded subgraphs only
    const labelToSg = new Map<string, { id: string; label: string }>();
    for (const sg of parsedAST.allSubgraphsFlat.values()) {
      if (!collapsedSubgraphIds.has(sg.id)) {
        // Normalize label for matching (Mermaid may strip HTML or add whitespace)
        const normalizedLabel = sg.label.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim().toLowerCase();
        labelToSg.set(normalizedLabel, { id: sg.id, label: sg.label });
      }
    }

    clusters.forEach(cluster => {
      // Try to match this cluster to a known subgraph by checking its label text
      const labelEl = cluster.querySelector(".cluster-label");
      if (!labelEl) return;

      const clusterLabelText = (labelEl.textContent || "").trim().toLowerCase();
      if (!clusterLabelText) return;

      // Find matching subgraph (try exact match first, then contains)
      let matched = labelToSg.get(clusterLabelText);
      if (!matched) {
        // Fallback: find by partial match
        for (const [normalizedLabel, sgInfo] of labelToSg.entries()) {
          if (clusterLabelText.includes(normalizedLabel) || normalizedLabel.includes(clusterLabelText)) {
            matched = sgInfo;
            break;
          }
        }
      }
      if (!matched) return;

      // Get the cluster rect position relative to the canvas container
      const clusterRect = cluster.getBoundingClientRect();
      const x = (clusterRect.right - layerRect.left) / zoom - 8; // 8px padding from right edge
      const y = (clusterRect.top - layerRect.top) / zoom + 4;    // 4px from top edge

      positions.push({
        subgraphId: matched.id,
        label: matched.label,
        mode: "collapse",
        x,
        y,
      });
      targets.push({ subgraphId: matched.id, mode: "collapse", element: cluster });

      // Remove from map to avoid duplicate matches
      const normalizedLabel = matched.label.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim().toLowerCase();
      labelToSg.delete(normalizedLabel);
    });

    const compoundNodes = diagramLayerRef.current.querySelectorAll(".node.node-compound");
    compoundNodes.forEach(node => {
      const nodeId = extractNodeId((node as SVGElement).id || "");
      if (!nodeId || !collapsedSubgraphIds.has(nodeId)) return;

      const subgraph = parsedAST.allSubgraphsFlat.get(nodeId);
      if (!subgraph) return;

      const nodeRect = node.getBoundingClientRect();
      const x = (nodeRect.right - layerRect.left) / zoom - 8;
      const y = (nodeRect.top - layerRect.top) / zoom + 4;

      positions.push({
        subgraphId: nodeId,
        label: subgraph.label,
        mode: "expand",
        x,
        y,
      });
      targets.push({ subgraphId: nodeId, mode: "expand", element: node });
    });

    listenerCleanupRef.current?.();
    const cleanups = targets.map((target) => {
      const key = `${target.mode}-${target.subgraphId}`;
      const handlePointerEnter = () => showToggle(key);
      const handlePointerMove = () => showToggle(key);
      const handlePointerLeave = (event: Event) => {
        const nextTarget = (event as PointerEvent).relatedTarget;
        if (nextTarget instanceof Element && nextTarget.closest(".subgraph-toggle-btn")) {
          return;
        }
        hideToggle();
      };

      target.element.addEventListener("pointerenter", handlePointerEnter);
      target.element.addEventListener("pointermove", handlePointerMove);
      target.element.addEventListener("pointerleave", handlePointerLeave);

      return () => {
        target.element.removeEventListener("pointerenter", handlePointerEnter);
        target.element.removeEventListener("pointermove", handlePointerMove);
        target.element.removeEventListener("pointerleave", handlePointerLeave);
      };
    });
    listenerCleanupRef.current = () => cleanups.forEach(cleanup => cleanup());

    targetsRef.current = targets;
    setTogglePositions(positions);

    const hoveredTarget = targets.find(target => target.element.matches(":hover"));
    if (hoveredTarget && !isPanning) {
      showToggle(`${hoveredTarget.mode}-${hoveredTarget.subgraphId}`);
    }
  }, [diagramLayerRef, parsedAST, collapsedSubgraphIds, zoom, isPanning, showToggle, hideToggle]);

  // Re-scan when the SVG re-renders (filteredCode changes) or transform changes
  useEffect(() => {
    // Small delay to let Mermaid finish rendering
    const timer = setTimeout(scanSubgraphToggles, 150);
    return () => clearTimeout(timer);
  }, [filteredCode, scanSubgraphToggles]);

  useEffect(() => {
    scanSubgraphToggles();
  }, [zoom, scanSubgraphToggles]);

  useEffect(() => {
    if (isPanning) {
      hideToggle();
      return;
    }

    scanSubgraphToggles();
  }, [isPanning, hideToggle, scanSubgraphToggles]);

  useEffect(() => {
    return () => {
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  if (togglePositions.length === 0) return null;

  return (
    <div className="subgraph-collapse-overlay">
      {togglePositions.map((pos) => (
        <button
          key={`${pos.mode}-${pos.subgraphId}`}
          className={`subgraph-toggle-btn subgraph-toggle-btn-${pos.mode} ${
            visibleToggleKey === `${pos.mode}-${pos.subgraphId}` ? "subgraph-toggle-btn-visible" : ""
          }`}
          style={{
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            transform: "translateX(-100%)", // anchor right edge to x position
            transformOrigin: "top right",
          }}
          onPointerMove={() => showToggle(`${pos.mode}-${pos.subgraphId}`)}
          onClick={(e) => {
            e.stopPropagation();
            if (pos.mode === "collapse") {
              onCollapse(pos.subgraphId);
            } else {
              onExpand(pos.subgraphId);
            }
          }}
          aria-label={`${pos.mode === "collapse" ? "Collapse" : "Expand"} ${pos.label}`}
          title={`${pos.mode === "collapse" ? "Collapse" : "Expand"} "${pos.label}"`}
        >
          {pos.mode === "collapse" ? (
            <svg
              className="subgraph-toggle-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg
              className="subgraph-toggle-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}
