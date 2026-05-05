import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import { apiListCanvases, apiCreateCanvas, apiDeleteCanvas } from "../lib/api";
import { exportAsMarkdown, exportAsZip, exportAsImage } from "../utils/export";
import { useMermaidThumbnails } from "../hooks/useMermaidThumbnails";

const INITIAL_LEVELS = [
  { id: 1, threshold: 0, name: "Initiate", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="50" stroke="currentColor" stroke-width="2" />\n<circle cx="110" cy="110" r="6" fill="currentColor" stroke="none" />' },
  { id: 2, threshold: 1, name: "Practitioner", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="55" stroke="currentColor" stroke-width="2" />\n<polygon points="110,75 145,135 75,135" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="5" fill="currentColor" stroke="none" />\n<circle cx="145" cy="135" r="5" fill="currentColor" stroke="none" />\n<circle cx="75" cy="135" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 3, threshold: 3, name: "Architect", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<rect x="60" y="60" width="100" height="100" stroke="currentColor" stroke-width="2" fill="none" />\n<polygon points="110,75 145,110 110,145 75,110" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="5" fill="currentColor" stroke="none" />\n<circle cx="145" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="145" r="5" fill="currentColor" stroke="none" />\n<circle cx="75" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 4, threshold: 10, name: "Researcher", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<rect x="60" y="60" width="100" height="100" stroke="currentColor" stroke-width="2" fill="none" />\n<polygon points="110,75 145,110 110,145 75,110" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="4" fill="currentColor" stroke="none" />\n<circle cx="145" cy="110" r="4" fill="currentColor" stroke="none" />\n<circle cx="110" cy="145" r="4" fill="currentColor" stroke="none" />\n<circle cx="75" cy="110" r="4" fill="currentColor" stroke="none" />\n<path d="M30 110 A80 80 0 0 1 190 110" stroke="currentColor" stroke-width="2" fill="none" />\n<path d="M110 30 A80 80 0 0 1 110 190" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="25" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="195" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="25" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="195" r="5" fill="currentColor" stroke="none" />\n<line x1="75" y1="110" x2="25" y2="110" stroke="currentColor" stroke-width="1.5" />\n<line x1="145" y1="110" x2="195" y2="110" stroke="currentColor" stroke-width="1.5" />\n<line x1="110" y1="75" x2="110" y2="25" stroke="currentColor" stroke-width="1.5" />\n<line x1="110" y1="145" x2="110" y2="195" stroke="currentColor" stroke-width="1.5" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 5, threshold: 50, name: "Lead Researcher", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="4" />\n<circle cx="110" cy="110" r="62" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="46" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="30" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="16" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="6" fill="currentColor" stroke="none" />' }
];

interface Canvas {
  id: string;
  title: string;
  mermaid_code: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);
  const [exportOptions, setExportOptions] = useState({ markdown: true, png: false });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAbove, setMenuAbove] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();
  const thumbnails = useMermaidThumbnails(canvases);
  const location = useLocation();
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const getAvatarStage = (flows: number) => {
    if (INITIAL_LEVELS.length === 0) return { level: 0, name: "No Levels", svg: "" };
    
    const sorted = [...INITIAL_LEVELS].sort((a, b) => b.threshold - a.threshold);
    const current = sorted.find(l => flows >= l.threshold) || sorted[sorted.length - 1];
    
    const ascending = [...INITIAL_LEVELS].sort((a, b) => a.threshold - b.threshold);
    const levelIndex = ascending.findIndex(l => l.id === current.id) + 1;

    return { level: levelIndex, name: current.name, svg: current.svg };
  };

  const { level, name: levelName, svg: levelSvg } = getAvatarStage(canvases.length);

  // Highlight the recently closed canvas card
  useEffect(() => {
    const cid = (location.state as Record<string, unknown> | null)?.closedCanvasId as string | undefined;
    if (cid) {
      setHighlightId(cid);
      // Clear router state to prevent re-trigger on refresh
      navigate(location.pathname, { replace: true, state: {} });
      const timer = setTimeout(() => setHighlightId(null), 2000);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCanvases();
  }, []);

  // Animated close helper
  const closeMenu = () => {
    if (!menuOpenId || menuClosing) return;
    setMenuClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setMenuOpenId(null);
      setMenuClosing(false);
    }, 180);
  };

  // Cleanup close timer on unmount
  useEffect(() => {
    return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });

  // Close menu on scroll
  useEffect(() => {
    if (!menuOpenId) return;
    const handleScroll = () => closeMenu();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  });

  const loadCanvases = async () => {
    try {
      const data = await apiListCanvases();
      setCanvases(data);
    } catch (err) {
      console.error("Failed to load canvases:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCanvas = async () => {
    try {
      const canvas = await apiCreateCanvas();
      navigate(`/canvas/${canvas.id}`);
    } catch (err) {
      console.error("Failed to create canvas:", err);
    }
  };

  const handleDeleteCanvas = async (id: string) => {
    if (!confirm("Are you sure you want to delete this canvas?")) return;
    try {
      await apiDeleteCanvas(id);
      setCanvases((prev) => prev.filter((c) => c.id !== id));
      setMenuOpenId(null);
    } catch (err) {
      console.error("Failed to delete canvas:", err);
    }
  };

  const handleExport = () => {
    const selected = canvases.filter((c) => selectedForExport.has(c.id));
    if (selected.length === 0) return;
    
    if (selected.length === 1) {
      if (exportOptions.markdown && !exportOptions.png) exportAsMarkdown(selected[0]);
      else if (!exportOptions.markdown && exportOptions.png) exportAsImage(selected[0]);
      else exportAsZip(selected, exportOptions);
    } else {
      exportAsZip(selected, exportOptions);
    }
    
    setExportMode(false);
    setSelectedForExport(new Set());
  };

  const toggleExportSelection = (id: string) => {
    setSelectedForExport((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const filtered = canvases.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-32">
      <TopBar showSearch onSearchChange={setSearch} />

      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* Title & Stats */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <h1 className="text-5xl font-extrabold tracking-tight text-primary mb-2 font-headline">
              My Canvases
            </h1>
            <p className="text-on-surface-variant max-w-md">
              Precision diagrams curated by your master drafter AI. Organize, edit, and export your architectural flows.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-surface-container-low px-6 py-4 rounded-xl flex items-center gap-4 group hover:bg-surface-container-highest transition-colors duration-300">
              <div className="relative shrink-0">
                <div className="w-14 h-14 bg-tertiary-fixed rounded-full flex items-center justify-center text-on-tertiary-fixed shadow-sm relative overflow-hidden">
                  <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  <div className="relative z-10 transition-transform duration-500 group-hover:scale-110 flex items-center justify-center w-full h-full">
                    <svg 
                      viewBox="28 28 164 164" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      className="w-full h-full"
                      dangerouslySetInnerHTML={{ __html: levelSvg }}
                    />
                  </div>
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-surface border-[2.5px] border-surface-container-low group-hover:border-surface-container-highest transition-colors rounded-full flex items-center justify-center text-[10px] font-bold text-primary z-20 shadow-sm">
                  {level}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold font-headline">
                  {canvases.length} {canvases.length === 1 ? 'Flow' : 'Flows'}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  {levelName}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search Bar Mobile */}
        <div className="md:hidden mb-8">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
              search
            </span>
            <input
              className="w-full bg-surface-container-high border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-secondary outline-none"
              placeholder="Search your library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Export bar */}
        {exportMode && (
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between bg-secondary-fixed/30 rounded-xl px-6 py-4 gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-on-surface">
                {selectedForExport.size} selected
              </span>
              <div className="h-4 w-[1px] bg-outline-variant/30 hidden md:block"></div>
              <div className="flex items-center gap-4 text-sm font-medium">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportOptions.markdown}
                    onChange={(e) => setExportOptions(prev => ({ ...prev, markdown: e.target.checked }))}
                    className="accent-secondary w-4 h-4 rounded"
                  />
                  Markdown (.md)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportOptions.png}
                    onChange={(e) => setExportOptions(prev => ({ ...prev, png: e.target.checked }))}
                    className="accent-secondary w-4 h-4 rounded"
                  />
                  Image (.png)
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 w-full md:w-auto">
              <button
                onClick={() => { setExportMode(false); setSelectedForExport(new Set()); }}
                className="text-sm font-bold text-on-surface-variant hover:text-on-surface"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={selectedForExport.size === 0 || (!exportOptions.markdown && !exportOptions.png)}
                className="px-4 py-2 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-40"
              >
                Export
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="spinner w-8 h-8" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <span className="material-symbols-outlined text-6xl text-outline-variant/40">
              dashboard_customize
            </span>
            <p className="text-on-surface-variant">
              {search ? "No canvases match your search" : "No canvases yet. Create your first one!"}
            </p>
          </div>
        ) : (
          /* Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map((canvas) => (
              <div
                key={canvas.id}
                className={`group bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 relative border border-transparent hover:border-outline-variant/20 cursor-pointer${highlightId === canvas.id ? " canvas-card-highlight" : ""}`}
                onClick={() => {
                  if (exportMode) {
                    toggleExportSelection(canvas.id);
                  } else {
                    navigate(`/canvas/${canvas.id}`);
                  }
                }}
              >
                {/* Export checkbox */}
                {exportMode && (
                  <div className="absolute top-4 right-4 z-20">
                    <div
                      className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                        selectedForExport.has(canvas.id)
                          ? "bg-secondary border-secondary text-white"
                          : "border-outline-variant bg-white/80"
                      }`}
                    >
                      {selectedForExport.has(canvas.id) && (
                        <span className="material-symbols-outlined text-sm">check</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Preview area */}
                <div className="aspect-video relative overflow-hidden bg-surface-container-high rounded-t-xl">
                  {/* Public badge */}
                  {canvas.is_public && (
                    <div 
                      className="absolute top-3 left-3 z-20 inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/90 backdrop-blur-sm shadow-sm"
                      title="Public"
                    >
                      <span className="material-symbols-outlined text-[13px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>public</span>
                    </div>
                  )}
                  <div className="w-full h-full flex items-center justify-center bg-surface-container-low canvas-grid">
                    {thumbnails[canvas.id] ? (
                      <div
                        className="thumb-preview w-full h-full flex items-center justify-center p-2 pointer-events-none"
                        dangerouslySetInnerHTML={{ __html: thumbnails[canvas.id] }}
                      />
                    ) : canvas.mermaid_code?.trim() ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="spinner w-5 h-5" />
                        <span className="text-[10px] text-on-surface-variant/50 font-medium">Rendering…</span>
                      </div>
                    ) : (
                      <span className="material-symbols-outlined text-4xl text-outline-variant/40">
                        account_tree
                      </span>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Card body */}
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-on-surface">{canvas.title}</h3>
                      <p className="text-sm text-on-surface-variant">
                        Modified {timeAgo(canvas.updated_at)}
                      </p>
                    </div>
                    <div className="relative" ref={menuOpenId === canvas.id ? menuRef : undefined}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (menuOpenId === canvas.id) {
                            setMenuOpenId(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const spaceBelow = window.innerHeight - rect.bottom;
                            setMenuAbove(spaceBelow < 220);
                            setMenuOpenId(canvas.id);
                          }
                        }}
                        className="text-on-surface-variant hover:text-primary p-2 hover:bg-surface-container-high rounded-lg transition-colors"
                      >
                        <span className="material-symbols-outlined">more_vert</span>
                      </button>

                      {(menuOpenId === canvas.id || (menuClosing && menuOpenId === canvas.id)) && (
                        <div className={`absolute right-0 ${menuAbove ? 'bottom-full mb-1' : 'top-full mt-1'} bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 min-w-[160px] z-30 card-menu-panel${menuAbove ? ' card-menu-above' : ''}${menuClosing ? ' card-menu-closing' : ''}`}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/canvas/${canvas.id}`);
                            }}
                            className="card-menu-item w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3"
                          >
                            <span className="material-symbols-outlined text-lg">edit</span>
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportAsMarkdown(canvas);
                              setMenuOpenId(null);
                            }}
                            className="card-menu-item w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3"
                          >
                            <span className="material-symbols-outlined text-lg">description</span>
                            Export .md
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportAsImage(canvas);
                              setMenuOpenId(null);
                            }}
                            className="card-menu-item w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3"
                          >
                            <span className="material-symbols-outlined text-lg">image</span>
                            Export .png
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCanvas(canvas.id);
                            }}
                            className="card-menu-item w-full px-4 py-2.5 text-left text-sm text-error hover:bg-error-container/20 flex items-center gap-3"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Export FAB (when not in export mode) */}
      {!exportMode && canvases.length > 0 && (
        <button
          onClick={() => setExportMode(true)}
          className="fixed bottom-28 left-8 z-50 bg-secondary-fixed text-on-secondary-fixed-variant w-14 h-14 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center md:bottom-8"
        >
          <span className="material-symbols-outlined text-2xl">download</span>
        </button>
      )}

      {/* FAB: New Canvas */}
      <button
        onClick={handleCreateCanvas}
        className="fixed bottom-28 right-8 z-50 bg-gradient-to-br from-primary to-primary-container text-white w-16 h-16 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center group md:bottom-8"
      >
        <span className="material-symbols-outlined text-3xl group-hover:rotate-90 transition-transform duration-300">
          add
        </span>
        <span className="absolute right-20 bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          New Canvas
        </span>
      </button>

      <BottomNav />
    </div>
  );
}
