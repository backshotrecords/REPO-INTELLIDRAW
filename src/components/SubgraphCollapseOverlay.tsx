/**
 * SubgraphCollapseOverlay — renders floating collapse buttons near each expanded subgraph.
 *
 * After MermaidRenderer renders SVG, this component scans the canvas for `.cluster`
 * elements, matches them to known subgraph IDs via label text, and positions small
 * floating "collapse" buttons near each expanded subgraph's header.
 */
import { type RefObject, useEffect, useState, useCallback } from "react";
import type { MermaidAST } from "../utils/mermaidParser";

interface ClusterPosition {
  subgraphId: string;
  label: string;
  /** Position relative to the canvas container */
  x: number;
  y: number;
}

interface SubgraphCollapseOverlayProps {
  canvasRef: RefObject<HTMLDivElement>;
  parsedAST: MermaidAST | null;
  collapsedSubgraphIds: Set<string>;
  onCollapse: (subgraphId: string) => void;
  panX: number;
  panY: number;
  zoom: number;
  /** Changes whenever the rendered SVG changes — triggers re-scan */
  filteredCode: string;
}

export default function SubgraphCollapseOverlay({
  canvasRef,
  parsedAST,
  collapsedSubgraphIds,
  onCollapse,
  panX,
  panY,
  zoom,
  filteredCode,
}: SubgraphCollapseOverlayProps) {
  const [clusterPositions, setClusterPositions] = useState<ClusterPosition[]>([]);

  /**
   * Build a reverse lookup: label text → subgraph ID.
   * Mermaid cluster labels contain the subgraph's display label, which we match
   * against our AST's subgraph labels to identify which cluster is which.
   */
  const scanClusters = useCallback(() => {
    if (!canvasRef.current || !parsedAST) {
      setClusterPositions([]);
      return;
    }

    const clusters = canvasRef.current.querySelectorAll(".cluster");
    if (!clusters.length) {
      setClusterPositions([]);
      return;
    }

    // Build label → subgraph ID map for expanded subgraphs only
    const labelToSg = new Map<string, { id: string; label: string }>();
    for (const sg of parsedAST.allSubgraphsFlat.values()) {
      if (!collapsedSubgraphIds.has(sg.id)) {
        // Normalize label for matching (Mermaid may strip HTML or add whitespace)
        const normalizedLabel = sg.label.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim().toLowerCase();
        labelToSg.set(normalizedLabel, { id: sg.id, label: sg.label });
      }
    }

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const positions: ClusterPosition[] = [];

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
      const x = clusterRect.right - canvasRect.left - 8; // 8px padding from right edge
      const y = clusterRect.top - canvasRect.top + 4;     // 4px from top edge

      positions.push({
        subgraphId: matched.id,
        label: matched.label,
        x,
        y,
      });

      // Remove from map to avoid duplicate matches
      const normalizedLabel = matched.label.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim().toLowerCase();
      labelToSg.delete(normalizedLabel);
    });

    setClusterPositions(positions);
  }, [canvasRef, parsedAST, collapsedSubgraphIds]);

  // Re-scan when the SVG re-renders (filteredCode changes) or transform changes
  useEffect(() => {
    // Small delay to let Mermaid finish rendering
    const timer = setTimeout(scanClusters, 150);
    return () => clearTimeout(timer);
  }, [filteredCode, scanClusters]);

  // Also re-scan on pan/zoom changes (positions are relative to canvas)
  useEffect(() => {
    scanClusters();
  }, [panX, panY, zoom, scanClusters]);

  if (clusterPositions.length === 0) return null;

  return (
    <div className="subgraph-collapse-overlay">
      {clusterPositions.map((pos) => (
        <button
          key={pos.subgraphId}
          className="subgraph-collapse-btn"
          style={{
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            transform: "translateX(-100%)", // anchor right edge to x position
          }}
          onClick={(e) => {
            e.stopPropagation();
            onCollapse(pos.subgraphId);
          }}
          title={`Collapse "${pos.label}"`}
        >
          <span className="material-symbols-outlined collapse-icon">unfold_less</span>
          <span className="collapse-label">{pos.label}</span>
        </button>
      ))}
    </div>
  );
}
