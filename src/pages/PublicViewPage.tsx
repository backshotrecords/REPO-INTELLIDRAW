import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MermaidRenderer from "../components/MermaidRenderer";
import SubgraphCollapseOverlay from "../components/SubgraphCollapseOverlay";
import { apiGetPublicCanvas } from "../lib/api";
import { getCanvasSettings, fetchCanvasSettings } from "../lib/canvasSettings";
import { parseMermaidAST, getRootViewWithCollapseState } from "../utils/mermaidParser";

export default function PublicViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState("Loading...");
  const [mermaidCode, setMermaidCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapsedSubgraphIds, setCollapsedSubgraphIds] = useState<Set<string>>(new Set());

  // Pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1); // synchronous mirror for wheel handler
  const isPanningRef = useRef(false);
  const [isPanningVisual, setIsPanningVisual] = useState(false);
  const [isWheeling, setIsWheeling] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const diagramLayerRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef<number | null>(null);

  const parsedAST = useMemo(() => {
    if (!mermaidCode?.trim()) return null;
    try {
      return parseMermaidAST(mermaidCode);
    } catch (err) {
      console.error("Public Mermaid parse error:", err);
      return null;
    }
  }, [mermaidCode]);

  const { filteredCode, compoundNodeIds } = useMemo(() => {
    if (!parsedAST) {
      return { filteredCode: mermaidCode, compoundNodeIds: [] as string[] };
    }

    const result = getRootViewWithCollapseState(parsedAST, collapsedSubgraphIds);
    return { filteredCode: result.code, compoundNodeIds: result.compoundNodeIds };
  }, [collapsedSubgraphIds, mermaidCode, parsedAST]);

  const hasSubgraphs = Boolean(parsedAST && parsedAST.allSubgraphsFlat.size > 0);
  const allGroupsCollapsed = Boolean(
    parsedAST &&
    parsedAST.allSubgraphsFlat.size > 0 &&
    collapsedSubgraphIds.size === parsedAST.allSubgraphsFlat.size
  );

  const collapseAllSubgraphs = useCallback(() => {
    if (!parsedAST) return;
    setCollapsedSubgraphIds(new Set(parsedAST.allSubgraphsFlat.keys()));
  }, [parsedAST]);

  const expandAllSubgraphs = useCallback(() => {
    setCollapsedSubgraphIds(new Set());
  }, []);

  // Pinch distance helper
  const getPointerDist = (): number | null => {
    const pts = Array.from(activePointers.current.values());
    if (pts.length < 2) return null;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.hypot(dx, dy);
  };

  useEffect(() => {
    fetchCanvasSettings();
    if (!id) return;

    const loadPublicCanvas = async () => {
      try {
        const canvas = await apiGetPublicCanvas(id);
        const nextCode = canvas.mermaid_code || "";
        setTitle(canvas.title);
        setMermaidCode(nextCode);

        try {
          const ast = parseMermaidAST(nextCode);
          setCollapsedSubgraphIds(new Set(ast.allSubgraphsFlat.keys()));
        } catch {
          setCollapsedSubgraphIds(new Set());
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    loadPublicCanvas();
  }, [id]);

  // ── Native wheel listener via callback ref ──
  // Re-attaches whenever React mounts a new canvas DOM element
  const wheelCleanupRef = useRef<(() => void) | null>(null);

  const canvasCallbackRef = useCallback((el: HTMLDivElement | null) => {
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    canvasRef.current = el;
    if (!el) return;

    let wheelTimer: ReturnType<typeof setTimeout>;
    let zoomVelocity = 0;
    let lastWheelTime = 0;
    let lastMx = 0;
    let lastMy = 0;
    let momentumFrame = 0;
    let wasZooming = false;

    const startZoomMomentum = () => {
      const DECAY = 0.92;
      const MIN_VELOCITY = 0.0005;

      const animate = () => {
        zoomVelocity *= DECAY;

        if (Math.abs(zoomVelocity) < MIN_VELOCITY) {
          zoomVelocity = 0;
          setIsWheeling(false);
          return;
        }

        const zoomFactor = 1 - zoomVelocity * 16 * 0.005;
        const maxZoom = getCanvasSettings().maxZoomLevel;
        const oldZoom = zoomRef.current;
        const newZoom = Math.min(maxZoom, Math.max(0.2, oldZoom * zoomFactor));

        if (newZoom === oldZoom) {
          zoomVelocity = 0;
          setIsWheeling(false);
          return;
        }

        const ratio = newZoom / oldZoom;
        zoomRef.current = newZoom;
        setZoom(newZoom);
        setPan(p => ({
          x: lastMx * (1 - ratio) + p.x * ratio,
          y: lastMy * (1 - ratio) + p.y * ratio,
        }));

        momentumFrame = requestAnimationFrame(animate);
      };

      momentumFrame = requestAnimationFrame(animate);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      cancelAnimationFrame(momentumFrame);

      setIsWheeling(true);
      clearTimeout(wheelTimer);

      if (e.ctrlKey || e.metaKey) {
        const clampedDelta = Math.max(-15, Math.min(15, e.deltaY));

        const now = performance.now();
        const dt = now - lastWheelTime;
        lastWheelTime = now;

        if (dt > 0 && dt < 200) {
          const instantVelocity = clampedDelta / dt;
          zoomVelocity = zoomVelocity * 0.5 + instantVelocity * 0.5;
        } else {
          zoomVelocity = 0;
        }

        const rect = el.getBoundingClientRect();
        lastMx = e.clientX - rect.left - rect.width / 2;
        lastMy = e.clientY - rect.top - rect.height / 2;

        const oldZoom = zoomRef.current;
        const zoomFactor = 1 - clampedDelta * 0.005;
        const maxZoom = getCanvasSettings().maxZoomLevel;
        const newZoom = Math.min(maxZoom, Math.max(0.2, oldZoom * zoomFactor));
        const ratio = newZoom / oldZoom;

        zoomRef.current = newZoom;
        setZoom(newZoom);
        setPan(p => ({
          x: lastMx * (1 - ratio) + p.x * ratio,
          y: lastMy * (1 - ratio) + p.y * ratio,
        }));
        wasZooming = true;
      } else {
        setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        wasZooming = false;
        zoomVelocity = 0;
      }

      wheelTimer = setTimeout(() => {
        if (wasZooming && Math.abs(zoomVelocity) > 0.001) {
          startZoomMomentum();
        } else {
          setIsWheeling(false);
        }
      }, 80);
    };

    el.addEventListener("wheel", onWheel, { passive: false });

    wheelCleanupRef.current = () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(momentumFrame);
      clearTimeout(wheelTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Prevent browser zoom globally (Ctrl/Cmd + wheel or Safari gestures) ──
  useEffect(() => {
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    const preventGesture = (e: Event) => e.preventDefault();
    document.addEventListener("wheel", preventBrowserZoom, { passive: false });
    document.addEventListener("gesturestart", preventGesture, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", preventGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      document.removeEventListener("wheel", preventBrowserZoom);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, []);

  // Pointer handlers — multi-pointer for pinch-zoom + single-pointer for pan
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!(e.target === canvasRef.current || (e.target as HTMLElement).closest(".canvas-area"))) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, label, textarea, select, [role='button']")) return;

    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      isPanningRef.current = true;
      setIsPanningVisual(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    } else if (activePointers.current.size === 2) {
      isPanningRef.current = false;
      setIsPanningVisual(false);
      lastPinchDist.current = getPointerDist();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      canvasRef.current.style.setProperty('--mouse-x', `${x}px`);
      canvasRef.current.style.setProperty('--mouse-y', `${y}px`);
    }

    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      // Pinch zoom
      const dist = getPointerDist();
      if (dist !== null && lastPinchDist.current !== null) {
        const delta = (dist - lastPinchDist.current) * 0.005;
        const maxZoom = getCanvasSettings().maxZoomLevel;
        setZoom((z) => { const n = Math.min(maxZoom, Math.max(0.2, z + delta)); zoomRef.current = n; return n; });
        lastPinchDist.current = dist;
      }
    } else if (activePointers.current.size === 1 && isPanningRef.current) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      lastPinchDist.current = null;
    }
    if (activePointers.current.size === 0) {
      isPanningRef.current = false;
      setIsPanningVisual(false);
    }
  };

  const handlePointerLeave = () => {
    if (canvasRef.current) {
      canvasRef.current.style.setProperty('--mouse-x', `-1000px`);
      canvasRef.current.style.setProperty('--mouse-y', `-1000px`);
    }
  };

  const handleZoomIn = () => {
    const maxZoom = getCanvasSettings().maxZoomLevel;
    setZoom((z) => { const n = Math.min(maxZoom, z + 0.2); zoomRef.current = n; return n; });
  };
  const handleZoomOut = () => {
    setZoom((z) => { const n = Math.max(0.2, z - 0.2); zoomRef.current = n; return n; });
  };
  const handleResetView = () => {
    zoomRef.current = 1;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span
            className="material-symbols-outlined text-5xl text-primary animate-pulse"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            draw
          </span>
          <span className="text-on-surface-variant text-sm font-medium">Loading canvas...</span>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-2xl bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-outline-variant/50">visibility_off</span>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-on-surface font-manrope mb-2">
              Canvas Not Found
            </h1>
            <p className="text-on-surface-variant text-sm leading-relaxed">
              This canvas doesn't exist or hasn't been published yet. The owner may have unpublished it.
            </p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-3 bg-primary text-white font-bold text-sm rounded-xl hover:shadow-lg active:scale-95 transition-all"
          >
            Go to IntelliDraw
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background font-body text-on-surface overflow-hidden h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-outline-variant/30 sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-4 py-3 gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span
              className="text-base sm:text-lg font-extrabold text-primary font-manrope tracking-tight cursor-pointer shrink-0"
              onClick={() => navigate("/")}
            >
              IntelliDraw
            </span>
            <div className="w-px h-4 sm:h-5 bg-outline-variant/30 shrink-0" />
            <h1 className="font-manrope font-extrabold text-base sm:text-lg tracking-tight text-on-surface truncate min-w-0">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasSubgraphs && (
              <>
                <button
                  onClick={expandAllSubgraphs}
                  disabled={collapsedSubgraphIds.size === 0}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 sm:px-3.5 rounded-full text-xs font-bold border border-outline-variant/20 transition-all duration-200 active:scale-95 ${
                    collapsedSubgraphIds.size === 0
                      ? "bg-surface-container-high/50 text-on-surface-variant/35 cursor-not-allowed"
                      : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                  }`}
                  title="Expand all groups"
                  aria-label="Expand all groups"
                >
                  <span className="material-symbols-outlined text-base">unfold_more</span>
                  <span className="hidden md:inline">Expand All</span>
                </button>
                <button
                  onClick={collapseAllSubgraphs}
                  disabled={allGroupsCollapsed}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 sm:px-3.5 rounded-full text-xs font-bold border border-outline-variant/20 transition-all duration-200 active:scale-95 ${
                    allGroupsCollapsed
                      ? "bg-surface-container-high/50 text-on-surface-variant/35 cursor-not-allowed"
                      : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                  }`}
                  title="Collapse all groups"
                  aria-label="Collapse all groups"
                >
                  <span className="material-symbols-outlined text-base">unfold_less</span>
                  <span className="hidden md:inline">Collapse All</span>
                </button>
              </>
            )}
            <button
              onClick={() => {
                navigator.clipboard.writeText(mermaidCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 sm:px-3.5 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low hover:text-on-surface transition-all duration-200 active:scale-95"
              title="Copy Mermaid code"
            >
              <span className="material-symbols-outlined text-base">
                {copied ? "check" : "content_copy"}
              </span>
              <span className="hidden sm:inline">{copied ? "Copied" : "Copy Code"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Canvas area */}
      <main className="relative flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div
            ref={canvasCallbackRef}
            className="flex-1 canvas-grid bg-surface relative overflow-hidden no-scrollbar touch-none canvas-area select-none"

            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            style={{ cursor: isPanningVisual ? "grabbing" : "grab" }}
          >
            {/* Zoom controls */}
            <div className="absolute left-4 bottom-4 flex flex-col gap-2 z-40">
              <div className="flex flex-col bg-white shadow-xl border border-outline-variant/30 rounded-full overflow-hidden">
                <button
                  onClick={handleZoomIn}
                  className="p-3 hover:bg-surface-container text-on-surface-variant material-symbols-outlined text-xl"
                >
                  zoom_in
                </button>
                <div className="h-px bg-outline-variant/20 mx-2" />
                <button
                  onClick={handleZoomOut}
                  className="p-3 hover:bg-surface-container text-on-surface-variant material-symbols-outlined text-xl"
                >
                  zoom_out
                </button>
              </div>
              <button
                onClick={handleResetView}
                className="p-3 bg-white shadow-xl border border-outline-variant/30 rounded-full hover:bg-surface-container text-on-surface-variant material-symbols-outlined text-xl"
              >
                fit_screen
              </button>
              <div className="text-[10px] font-bold text-on-surface-variant/50 text-center">
                {Math.round(zoom * 100)}%
              </div>
            </div>

            {/* Rendered diagram */}
            <div
              ref={diagramLayerRef}
              className="h-full min-h-0 w-full flex items-center justify-center relative"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: (isPanningVisual || isWheeling) ? "none" : "transform 0.1s ease-out",
              }}
            >
              <MermaidRenderer
                code={filteredCode}
                className="min-h-[400px] min-w-[300px]"
                compoundNodeIds={compoundNodeIds}
                parsedAST={parsedAST}
              />
              <SubgraphCollapseOverlay
                diagramLayerRef={diagramLayerRef}
                parsedAST={parsedAST}
                collapsedSubgraphIds={collapsedSubgraphIds}
                onCollapse={(subgraphId) => {
                  setCollapsedSubgraphIds(prev => new Set([...prev, subgraphId]));
                }}
                onExpand={(subgraphId) => {
                  setCollapsedSubgraphIds(prev => {
                    const next = new Set(prev);
                    next.delete(subgraphId);
                    return next;
                  });
                }}
                filteredCode={filteredCode}
                zoom={zoom}
                isCanvasInteracting={isPanningVisual || isWheeling}
              />
            </div>
          </div>

          {/* Footer branding */}
          <div className="bg-white/80 backdrop-blur-sm border-t border-outline-variant/20 px-4 py-2.5 flex items-center justify-center gap-2">
            <span
              className="material-symbols-outlined text-sm text-primary/50"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              draw
            </span>
            <span className="text-[11px] font-semibold text-on-surface-variant/50">
              Created with IntelliDraw
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
