import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { getRenderedClusterSubgraphId } from "../utils/mermaidDom";
import type { MermaidAST } from "../utils/mermaidParser";

interface MermaidRendererProps {
  code: string;
  className?: string;
  onSyntaxError?: (errorMsg: string, code: string) => void;
  onRenderStart?: (code: string) => void;
  onRenderComplete?: (code: string) => void;
  onRenderError?: (code: string) => void;
  isFixing?: boolean;
  /** Node ID currently "active" (tapped, showing the "+" button) */
  activeNodeId?: string | null;
  /** Node IDs currently selected (pills exist) */
  selectedNodeIds?: string[];
  /** Node IDs that are greyed-out external boundary references */
  boundaryNodeIds?: string[];
  /** Node IDs that are compound nodes (collapsed subgraphs) */
  compoundNodeIds?: string[];
  parsedAST?: MermaidAST | null;
}

// Configure mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "loose",
  fontFamily: "Inter, sans-serif",
  flowchart: {
    curve: "basis",
    padding: 20,
    htmlLabels: true,
    useMaxWidth: true,
  },
});

let renderCounter = 0;

/**
 * Remove any orphaned mermaid error SVGs that get injected into document.body
 * when mermaid.render() throws (the bomb icon / "Syntax error in text" elements).
 */
function cleanupMermaidErrors() {
  // Mermaid injects elements with id starting with "d" or the render id into body
  document.querySelectorAll("body > [id^='dmermaid'], body > svg[id^='mermaid'], body > [id^='mermaid-diagram']").forEach((el) => el.remove());
  // Also clean up any stray mermaid error containers with the bomb icon
  document.querySelectorAll("body > #d, body > svg[aria-roledescription='error']").forEach((el) => el.remove());
  // Catch-all: remove any direct-child SVGs in body that contain the mermaid error class
  document.querySelectorAll("body > svg").forEach((el) => {
    if (el.querySelector(".error-icon") || el.textContent?.includes("Syntax error")) {
      el.remove();
    }
  });
  // Remove any div wrappers mermaid might create for errors
  document.querySelectorAll("body > div[id^='dmermaid'], body > div[id^='d']").forEach((el) => {
    if (el.querySelector("svg") || el.textContent?.includes("Syntax error")) {
      el.remove();
    }
  });
}

/**
 * Extract the Mermaid node ID from an SVG element's id attribute.
 * Handles patterns like: flowchart-A-0, flowchart-RazorBlades-7, flowchart-OBJ-12
 * The node ID can contain any characters except the trailing -\d+ index.
 */
export function extractNodeId(svgElementId: string): string | null {
  // Strip common prefixes and extract the node ID before the trailing -number
  const match = svgElementId.match(/(?:flowchart|graph)-(.+)-\d+$/);
  return match ? match[1] : null;
}

function getClusterSubgraphId(cluster: Element, parsedAST: MermaidAST | null): string | null {
  return getRenderedClusterSubgraphId(cluster, parsedAST);
}

export default function MermaidRenderer({
  code, className = "", onSyntaxError, onRenderStart, onRenderComplete, onRenderError, isFixing = false,
  activeNodeId, selectedNodeIds,
  boundaryNodeIds, compoundNodeIds, parsedAST
}: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  // Track whether auto-fix has already been triggered for this exact code
  const fixTriggeredForRef = useRef<string | null>(null);

  // Stable ref for the callback so useEffect doesn't re-run when callback identity changes
  const onSyntaxErrorRef = useRef(onSyntaxError);
  onSyntaxErrorRef.current = onSyntaxError;
  const onRenderStartRef = useRef(onRenderStart);
  onRenderStartRef.current = onRenderStart;
  const onRenderCompleteRef = useRef(onRenderComplete);
  onRenderCompleteRef.current = onRenderComplete;
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const renderTokenRef = useRef(0);

  useEffect(() => {
    const token = ++renderTokenRef.current;
    let cancelled = false;

    if (!code?.trim()) {
      setSvgHtml("");
      setError(null);
      onRenderCompleteRef.current?.("");
      return;
    }

    // If we're currently fixing, don't attempt to re-render
    if (isFixing) return;

    const codeToRender = code.trim();
    onRenderStartRef.current?.(codeToRender);

    const renderDiagram = async () => {
      try {
        renderCounter++;
        const id = `mermaid-diagram-${renderCounter}`;
        const { svg } = await mermaid.render(id, codeToRender);
        if (cancelled || renderTokenRef.current !== token) return;
        setSvgHtml(svg);
        setError(null);
        // Successful render — reset the fix tracker
        fixTriggeredForRef.current = null;
        // Clean up any leftover error elements from prior failures
        cleanupMermaidErrors();
        onRenderCompleteRef.current?.(codeToRender);
      } catch (err) {
        if (cancelled || renderTokenRef.current !== token) return;
        console.error("Mermaid render error:", err);
        const errMsg = err instanceof Error ? err.message : "Failed to render diagram";

        // Clean up the bomb icons mermaid just injected
        cleanupMermaidErrors();
        onRenderErrorRef.current?.(codeToRender);

        // Only fire auto-fix once per unique code string
        if (onSyntaxErrorRef.current && fixTriggeredForRef.current !== codeToRender) {
          fixTriggeredForRef.current = codeToRender;
          onSyntaxErrorRef.current(errMsg, codeToRender);
          // Don't set error state — the parent will handle it silently
          setError(null);
        } else if (!onSyntaxErrorRef.current) {
          setError(errMsg);
        }
        setSvgHtml("");
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, isFixing]);

  // Also clean up on unmount
  useEffect(() => {
    return () => cleanupMermaidErrors();
  }, []);

  // ── Apply visual state classes to SVG nodes ──
  // (Tap detection is handled by the parent WorkspacePage via canvas pointer events)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svgHtml) return;

    const nodes = container.querySelectorAll(".node");
    nodes.forEach((node) => {
      const svgId = node.id || "";
      const nodeId = extractNodeId(svgId);
      if (!nodeId) return;

      // Active state
      if (activeNodeId === nodeId) {
        node.classList.add("node-active");
      } else {
        node.classList.remove("node-active");
      }

      // Selected state
      if (selectedNodeIds?.includes(nodeId)) {
        node.classList.add("node-selected");
      } else {
        node.classList.remove("node-selected");
      }

      // External boundary reference state (greyed out)
      if (boundaryNodeIds?.includes(nodeId)) {
        node.classList.add("node-external-ref");
      } else {
        node.classList.remove("node-external-ref");
      }

      // Compound node state (collapsed subgraph)
      if (compoundNodeIds?.includes(nodeId)) {
        node.classList.add("node-compound");
      } else {
        node.classList.remove("node-compound");
      }
    });

    // Apply visual state classes to SVG clusters (expanded subgraphs)
    const clusters = container.querySelectorAll(".cluster");
    clusters.forEach((cluster) => {
      const sgId = getClusterSubgraphId(cluster, parsedAST || null);
      if (!sgId) return;

      // Active state
      if (activeNodeId === sgId) {
        cluster.classList.add("cluster-active");
      } else {
        cluster.classList.remove("cluster-active");
      }

      // Selected state
      if (selectedNodeIds?.includes(sgId)) {
        cluster.classList.add("cluster-selected");
      } else {
        cluster.classList.remove("cluster-selected");
      }
    });
  }, [svgHtml, activeNodeId, selectedNodeIds, boundaryNodeIds, compoundNodeIds, parsedAST]);

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="bg-error-container/30 rounded-xl p-6 max-w-md w-full border border-error/10">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="material-symbols-outlined text-error text-lg"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              error
            </span>
            <span className="text-sm font-bold text-on-error-container">Render Error</span>
          </div>
          <p className="text-xs text-on-error-container/70 font-mono leading-relaxed">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (isFixing) {
    return (
      <div className={`flex flex-col items-center justify-center p-12 ${className}`}>
        <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/20 flex flex-col items-center gap-4">
           <div className="spinner w-8 h-8 border-t-primary" />
           <p className="text-sm font-semibold text-primary tracking-tight">Debugging new code...</p>
        </div>
      </div>
    );
  }

  if (!svgHtml) {
    return (
      <div className={`flex items-center justify-center p-12 ${className}`}>
        <div className="flex flex-col items-center gap-3 text-on-surface-variant/50">
          <span className="material-symbols-outlined text-4xl">draw</span>
          <p className="text-sm">Start chatting to generate a flowchart</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container flex items-center justify-center p-4 ${className}`}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}
