import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MermaidRenderer from "../components/MermaidRenderer";
import { apiGetPublicCanvas } from "../lib/api";

export default function PublicViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState("Loading...");
  const [mermaidCode, setMermaidCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    const loadPublicCanvas = async () => {
      try {
        const canvas = await apiGetPublicCanvas(id);
        setTitle(canvas.title);
        setMermaidCode(canvas.mermaid_code);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    loadPublicCanvas();
  }, [id]);

  // Pan/Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(16, Math.max(0.2, z + delta)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).closest(".canvas-area")) {
      setIsPanning(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastPanPos.current.x;
    const dy = e.clientY - lastPanPos.current.y;
    lastPanPos.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handlePointerUp = () => {
    setIsPanning(false);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(16, z + 0.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, z - 0.2));
  const handleResetView = () => {
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
        <div className="flex justify-between items-center w-full px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="text-lg font-extrabold text-primary font-manrope tracking-tight cursor-pointer"
              onClick={() => navigate("/")}
            >
              IntelliDraw
            </span>
            <div className="w-px h-5 bg-outline-variant/30" />
            <h1 className="font-manrope font-extrabold text-lg tracking-tight text-on-surface truncate max-w-[200px] sm:max-w-md">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/50">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Public</span>
            </div>
          </div>
        </div>
      </header>

      {/* Canvas area */}
      <main className="relative flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div
            ref={canvasRef}
            className="flex-1 canvas-grid bg-surface relative overflow-hidden no-scrollbar touch-none canvas-area"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ cursor: isPanning ? "grabbing" : "grab" }}
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
              className="min-h-full w-full flex items-center justify-center"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isPanning ? "none" : "transform 0.1s ease-out",
              }}
            >
              <MermaidRenderer
                code={mermaidCode}
                className="min-h-[400px] min-w-[300px]"
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
