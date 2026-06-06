import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import DashboardCanvasTreeView from "../components/DashboardCanvasTreeView";
import DashboardFileViewToggle, { type DashboardFileViewMode } from "../components/DashboardFileViewToggle";
import {
  apiCreateCanvas,
  apiCreateProject,
  apiDeleteCanvas,
  apiDeleteProject,
  apiGetCanvasPreviewCodes,
  apiListCanvases,
  apiListProjects,
  apiRefreshProjectContext,
  apiUpdateCanvas,
  apiUpdateProject,
} from "../lib/api";
import { exportAsImage, exportAsMarkdown, exportAsZip } from "../utils/export";
import { useMermaidThumbnails } from "../hooks/useMermaidThumbnails";
import type { CanvasProject, DashboardCanvas, ProjectAccent } from "../types";
import { isLongTermMemoryItem } from "../types";

const THUMBNAIL_BATCH_SIZE = 9;

const INITIAL_LEVELS = [
  { id: 1, threshold: 0, name: "Initiate", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="50" stroke="currentColor" stroke-width="2" />\n<circle cx="110" cy="110" r="6" fill="currentColor" stroke="none" />' },
  { id: 2, threshold: 3, name: "Practitioner", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="55" stroke="currentColor" stroke-width="2" />\n<polygon points="110,75 145,135 75,135" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="5" fill="currentColor" stroke="none" />\n<circle cx="145" cy="135" r="5" fill="currentColor" stroke="none" />\n<circle cx="75" cy="135" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 3, threshold: 10, name: "Architect", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<rect x="60" y="60" width="100" height="100" stroke="currentColor" stroke-width="2" fill="none" />\n<polygon points="110,75 145,110 110,145 75,110" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="5" fill="currentColor" stroke="none" />\n<circle cx="145" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="145" r="5" fill="currentColor" stroke="none" />\n<circle cx="75" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 4, threshold: 50, name: "Researcher", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="3" />\n<rect x="60" y="60" width="100" height="100" stroke="currentColor" stroke-width="2" fill="none" />\n<polygon points="110,75 145,110 110,145 75,110" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="110" cy="75" r="4" fill="currentColor" stroke="none" />\n<circle cx="145" cy="110" r="4" fill="currentColor" stroke="none" />\n<circle cx="110" cy="145" r="4" fill="currentColor" stroke="none" />\n<circle cx="75" cy="110" r="4" fill="currentColor" stroke="none" />\n<path d="M30 110 A80 80 0 0 1 190 110" stroke="currentColor" stroke-width="2" fill="none" />\n<path d="M110 30 A80 80 0 0 1 110 190" stroke="currentColor" stroke-width="2" fill="none" />\n<circle cx="25" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="195" cy="110" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="25" r="5" fill="currentColor" stroke="none" />\n<circle cx="110" cy="195" r="5" fill="currentColor" stroke="none" />\n<line x1="75" y1="110" x2="25" y2="110" stroke="currentColor" stroke-width="1.5" />\n<line x1="145" y1="110" x2="195" y2="110" stroke="currentColor" stroke-width="1.5" />\n<line x1="110" y1="75" x2="110" y2="25" stroke="currentColor" stroke-width="1.5" />\n<line x1="110" y1="145" x2="110" y2="195" stroke="currentColor" stroke-width="1.5" />\n<circle cx="110" cy="110" r="4" fill="currentColor" stroke="none" />' },
  { id: 5, threshold: 100, name: "Lead Researcher", svg: '<circle cx="110" cy="110" r="80" stroke="currentColor" stroke-width="4" />\n<circle cx="110" cy="110" r="62" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="46" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="30" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="16" stroke="currentColor" stroke-width="3" />\n<circle cx="110" cy="110" r="6" fill="currentColor" stroke="none" />' },
];

type MenuState = { type: "canvas" | "project"; id: string } | null;
type ProjectDraft = { title: string; description: string; accent: ProjectAccent };

export default function DashboardPage() {
  const [canvases, setCanvases] = useState<DashboardCanvas[]>([]);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedForExport, setSelectedForExport] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState(false);
  const [exportOptions, setExportOptions] = useState({ markdown: true, png: false });
  const [menuOpen, setMenuOpen] = useState<MenuState>(null);
  const [menuAbove, setMenuAbove] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [canvasesCollapsed, setCanvasesCollapsed] = useState(false);
  const [archiveOnly, setArchiveOnly] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectWizard, setProjectWizard] = useState<{ mode: "create" } | { mode: "edit"; projectId: string } | null>(null);
  const [movingCanvasId, setMovingCanvasId] = useState<string | null>(null);
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [thumbnailLimit, setThumbnailLimit] = useState(THUMBNAIL_BATCH_SIZE);
  const [fileViewMode, setFileViewMode] = useState<DashboardFileViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    const storedMode = window.localStorage.getItem("intellidraw.dashboard.fileViewMode");
    return storedMode === "tree" || storedMode === "grid" ? storedMode : "grid";
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadMoreThumbsRef = useRef<HTMLSpanElement>(null);
  const projectContextRefreshesRef = useRef<Set<string>>(new Set());
  const activeProjectContextRequestRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const dashboardSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const activeProjectId = dashboardSearchParams.get("project");
  const requestedArchiveOnly = dashboardSearchParams.get("archive") === "1";
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) ?? null : null;
  const { level, name: levelName, svg: levelSvg } = getAvatarStage(canvases.length);

  const projectPath = useMemo(() => {
    if (!activeProject) return [];
    const byId = new Map(projects.map((project) => [project.id, project]));
    const path: CanvasProject[] = [];
    let current: CanvasProject | undefined = activeProject;
    while (current) {
      path.unshift(current);
      current = current.parent_project_id ? byId.get(current.parent_project_id) : undefined;
    }
    return path;
  }, [activeProject, projects]);

  const childProjects = useMemo(
    () => projects.filter((project) => activeProjectId ? project.parent_project_id === activeProjectId : !project.parent_project_id),
    [activeProjectId, projects],
  );
  const scopedCanvases = useMemo(
    () => canvases.filter((canvas) => activeProjectId ? canvas.project_id === activeProjectId : !canvas.project_id),
    [activeProjectId, canvases],
  );
  const visibleProjects = useMemo(
    () => childProjects
      .filter((project) => archiveOnly ? isLongTermMemoryItem(project) : !isLongTermMemoryItem(project))
      .filter((project) => matchesSearch(project.title, search)),
    [archiveOnly, childProjects, search],
  );
  const visibleCanvases = useMemo(
    () => scopedCanvases
      .filter((canvas) => archiveOnly ? isLongTermMemoryItem(canvas) : !isLongTermMemoryItem(canvas))
      .filter((canvas) => matchesSearch(canvas.title, search)),
    [archiveOnly, scopedCanvases, search],
  );
  const previewEligibleCanvases = useMemo(
    () => visibleCanvases.slice(0, thumbnailLimit),
    [thumbnailLimit, visibleCanvases],
  );
  const thumbnails = useMermaidThumbnails(previewEligibleCanvases);
  const projectCanvasCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) counts.set(project.id, 0);
    for (const canvas of canvases) {
      if (canvas.project_id) counts.set(canvas.project_id, (counts.get(canvas.project_id) ?? 0) + 1);
    }
    return counts;
  }, [canvases, projects]);
  const projectFolderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) counts.set(project.id, 0);
    for (const project of projects) {
      if (project.parent_project_id) counts.set(project.parent_project_id, (counts.get(project.parent_project_id) ?? 0) + 1);
    }
    return counts;
  }, [projects]);
  const archiveCount = useMemo(() => (
    childProjects.filter(isLongTermMemoryItem).length + scopedCanvases.filter(isLongTermMemoryItem).length
  ), [childProjects, scopedCanvases]);
  const shortTermFolderCanvasCount = scopedCanvases.filter((canvas) => !isLongTermMemoryItem(canvas)).length;
  const hasProjectSection = visibleProjects.length > 0;
  const showCanvasTreeView = Boolean(activeProject && fileViewMode === "tree");
  const movingCanvas = movingCanvasId ? canvases.find((canvas) => canvas.id === movingCanvasId) ?? null : null;
  const movingProject = movingProjectId ? projects.find((project) => project.id === movingProjectId) ?? null : null;
  const editingProject = projectWizard?.mode === "edit"
    ? projects.find((project) => project.id === projectWizard.projectId) ?? null
    : null;

  useEffect(() => {
    const cid = (location.state as Record<string, unknown> | null)?.closedCanvasId as string | undefined;
    if (!cid) return;
    setHighlightId(cid);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: {} });
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(timer);
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    setArchiveOnly(requestedArchiveOnly);
  }, [requestedArchiveOnly]);

  useEffect(() => {
    setThumbnailLimit(THUMBNAIL_BATCH_SIZE);
  }, [activeProjectId, archiveOnly, search]);

  useEffect(() => {
    window.localStorage.setItem("intellidraw.dashboard.fileViewMode", fileViewMode);
  }, [fileViewMode]);

  useEffect(() => {
    const sentinel = loadMoreThumbsRef.current;
    if (!sentinel || thumbnailLimit >= visibleCanvases.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setThumbnailLimit((current) => Math.min(current + THUMBNAIL_BATCH_SIZE, visibleCanvases.length));
      },
      { rootMargin: "700px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [thumbnailLimit, visibleCanvases.length]);

  useEffect(() => {
    if (!activeProjectId || loading) return;
    if (!projects.some((project) => project.id === activeProjectId)) navigate("/dashboard", { replace: true });
  }, [activeProjectId, loading, navigate, projects]);

  useEffect(() => {
    if (!activeProjectId) {
      activeProjectContextRequestRef.current = null;
      return;
    }
    if (loading || !projects.some((project) => project.id === activeProjectId)) return;
    if (activeProjectContextRequestRef.current === activeProjectId) return;
    activeProjectContextRequestRef.current = activeProjectId;
    refreshProjectContextInBackground(activeProjectId);
  }, [activeProjectId, loading, projects]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const handleScroll = () => closeMenu();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  });

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const [canvasData, projectData] = await Promise.all([apiListCanvases(), apiListProjects()]);
      setCanvases(canvasData);
      setProjects(projectData);
    } catch (err) {
      console.error("Failed to load dashboard:", err);
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  function closeMenu() {
    if (!menuOpen || menuClosing) return;
    setMenuClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setMenuOpen(null);
      setMenuClosing(false);
    }, 180);
  }

  function openMenu(type: "canvas" | "project", id: string, button: HTMLButtonElement) {
    if (menuOpen?.type === type && menuOpen.id === id) {
      setMenuOpen(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setMenuAbove(window.innerHeight - rect.bottom < 300);
    setMenuClosing(false);
    setMenuOpen({ type, id });
  }

  function navigateToProject(projectId: string | null) {
    setArchiveOnly(false);
    setMenuOpen(null);
    setSelectedForExport(new Set());
    setExportMode(false);
    navigate(projectId ? `/dashboard?project=${projectId}` : "/dashboard");
  }

  function refreshProjectContextInBackground(projectId: string) {
    if (projectContextRefreshesRef.current.has(projectId)) return;
    projectContextRefreshesRef.current.add(projectId);
    apiRefreshProjectContext(projectId)
      .then((result) => {
        setProjects((current) => current.map((project) => (
          project.id === result.project.id ? result.project : project
        )));
      })
      .catch((err) => {
        console.error("Project context refresh failed:", err);
      })
      .finally(() => {
        projectContextRefreshesRef.current.delete(projectId);
      });
  }

  async function handleCreateCanvas() {
    try {
      const canvas = await apiCreateCanvas(undefined, undefined, activeProjectId);
      navigate(`/canvas/${canvas.id}`);
    } catch (err) {
      console.error("Failed to create canvas:", err);
      setError(err instanceof Error ? err.message : "Failed to create canvas");
    }
  }

  async function handleSaveProject(draft: ProjectDraft) {
    try {
      if (projectWizard?.mode === "edit") {
        const project = await apiUpdateProject(projectWizard.projectId, draft);
        setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      } else {
        const project = await apiCreateProject({ ...draft, parentProjectId: activeProjectId });
        setProjects((current) => [project, ...current]);
        navigateToProject(project.id);
      }
      setProjectWizard(null);
      setArchiveOnly(false);
    } catch (err) {
      console.error("Failed to save project:", err);
      setError(err instanceof Error ? err.message : "Failed to save project");
    }
  }

  async function handleArchiveCanvas(canvas: DashboardCanvas) {
    try {
      const updated = await apiUpdateCanvas(canvas.id, { manuallyArchived: true });
      setCanvases((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedForExport((current) => {
        const next = new Set(current);
        next.delete(canvas.id);
        return next;
      });
      setArchiveOnly(true);
      setCanvasesCollapsed(false);
      setMenuOpen(null);
    } catch (err) {
      console.error("Failed to archive canvas:", err);
      setError(err instanceof Error ? err.message : "Failed to archive canvas");
    }
  }

  async function handleDeleteCanvas(id: string) {
    if (!confirm("Are you sure you want to delete this canvas?")) return;
    try {
      await apiDeleteCanvas(id);
      setSelectedForExport((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setMenuOpen(null);
      await loadDashboard();
    } catch (err) {
      console.error("Failed to delete canvas:", err);
      setError(err instanceof Error ? err.message : "Failed to delete canvas");
    }
  }

  async function handleArchiveProject(project: CanvasProject) {
    try {
      const updated = await apiUpdateProject(project.id, { manuallyArchived: true });
      setProjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      setArchiveOnly(true);
      setProjectsCollapsed(false);
      setMenuOpen(null);
    } catch (err) {
      console.error("Failed to archive project:", err);
      setError(err instanceof Error ? err.message : "Failed to archive project");
    }
  }

  async function handleDeleteProject(project: CanvasProject) {
    if (!confirm(`Delete "${project.title}" and all canvases inside it?`)) return;
    const idsToDelete = getProjectAndDescendantIds(project.id, projects);
    try {
      await apiDeleteProject(project.id);
      setMenuOpen(null);
      if (activeProjectId && idsToDelete.has(activeProjectId)) {
        navigateToProject(project.parent_project_id);
      }
      await loadDashboard();
    } catch (err) {
      console.error("Failed to delete project:", err);
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  }

  async function handleMoveCanvas(targetProjectId: string | null) {
    if (!movingCanvas) return;
    try {
      const updated = await apiUpdateCanvas(movingCanvas.id, { projectId: targetProjectId });
      setCanvases((current) => [updated, ...current.filter((canvas) => canvas.id !== updated.id)]);
      setMovingCanvasId(null);
      setMenuOpen(null);
    } catch (err) {
      console.error("Failed to move canvas:", err);
      setError(err instanceof Error ? err.message : "Failed to move canvas");
    }
  }

  async function handleMoveProject(targetProjectId: string | null) {
    if (!movingProject) return;
    try {
      const updated = await apiUpdateProject(movingProject.id, { parentProjectId: targetProjectId });
      setProjects((current) => [updated, ...current.filter((project) => project.id !== updated.id)]);
      setMovingProjectId(null);
      setMenuOpen(null);
      setArchiveOnly(false);
      navigateToProject(targetProjectId);
    } catch (err) {
      console.error("Failed to move project:", err);
      setError(err instanceof Error ? err.message : "Failed to move project");
    }
  }

  async function loadCanvasExportData(ids: string[]) {
    const previewCodes = await apiGetCanvasPreviewCodes(ids);
    const byId = new Map(previewCodes.map((canvas) => [canvas.id, canvas]));
    return ids.map((id) => {
      const canvas = byId.get(id);
      if (!canvas) throw new Error("Failed to fetch one or more selected canvases");
      return { title: canvas.title, mermaid_code: canvas.mermaid_code };
    });
  }

  async function handleExport() {
    const selectedIds = canvases
      .filter((canvas) => selectedForExport.has(canvas.id))
      .map((canvas) => canvas.id);
    if (selectedIds.length === 0) return;

    try {
      const selected = await loadCanvasExportData(selectedIds);
      if (selected.length === 1) {
        if (exportOptions.markdown && !exportOptions.png) exportAsMarkdown(selected[0]);
        else if (!exportOptions.markdown && exportOptions.png) await exportAsImage(selected[0]);
        else await exportAsZip(selected, exportOptions);
      } else {
        await exportAsZip(selected, exportOptions);
      }
      setExportMode(false);
      setSelectedForExport(new Set());
    } catch (err) {
      console.error("Failed to export canvases:", err);
      setError(err instanceof Error ? err.message : "Failed to export canvases");
    }
  }

  function toggleExportSelection(id: string) {
    setSelectedForExport((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProjectsCollapsed() {
    setProjectsCollapsed((current) => {
      const next = !current;
      if (next && canvasesCollapsed) setCanvasesCollapsed(false);
      return next;
    });
  }

  function toggleCanvasesCollapsed() {
    setCanvasesCollapsed((current) => {
      const next = !current;
      if (next && projectsCollapsed) setProjectsCollapsed(false);
      return next;
    });
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-32">
      <TopBar showSearch searchVisibility="desktop" onSearchChange={setSearch} />

      <main className="max-w-7xl mx-auto px-6 pt-8">
        {projectPath.length > 0 && (
          <ProjectBreadcrumb
            path={projectPath}
            onNavigate={navigateToProject}
            action={<DashboardFileViewToggle mode={fileViewMode} onChange={setFileViewMode} />}
          />
        )}

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-5xl font-extrabold tracking-tight text-primary font-headline">
                {activeProject?.title ?? "My Canvases"}
              </h1>
              {activeProject && (
                <button
                  type="button"
                  aria-label="Edit project details"
                  title="Edit project details"
                  onClick={() => setProjectWizard({ mode: "edit", projectId: activeProject.id })}
                  className="w-10 h-10 rounded-full bg-surface-container-lowest border border-outline-variant/30 shadow-sm hover:bg-surface-container-low flex items-center justify-center text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[22px]">edit</span>
                </button>
              )}
            </div>
            <p className="text-on-surface-variant max-w-md">
              {activeProject?.description || "Precision diagrams curated by your master drafter AI. Organize, edit, and export your architectural flows."}
            </p>
          </div>
          <div className="flex gap-4">
            {activeProject ? (
              <StatCard
                icon="folder_open"
                count={shortTermFolderCanvasCount}
                label={shortTermFolderCanvasCount === 1 ? "Canvas" : "Canvases"}
                detail="In short-term memory"
              />
            ) : (
              <GuildCard count={canvases.length} level={level} levelName={levelName} levelSvg={levelSvg} onClick={() => navigate("/guild")} />
            )}
            <button
              type="button"
              aria-pressed={archiveOnly}
              onClick={() => setArchiveOnly((current) => !current)}
              className={`archive-memory-card bg-surface-container-lowest px-6 py-4 rounded-xl flex items-center gap-4 border shadow-sm hover:bg-surface-container-low transition-colors ${archiveOnly ? "border-black ring-2 ring-black" : "border-outline-variant/20"}`}
            >
              <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${archiveOnly ? "bg-primary" : "bg-surface-container-high"}`}>
                <span className={`material-symbols-outlined ${archiveOnly ? "text-white" : "text-primary"}`}>archive</span>
              </span>
              <span className="archive-memory-content text-left">
                <strong className="block text-2xl font-bold font-headline">{archiveCount} Items</strong>
                <small className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">In long-term memory</small>
              </span>
              {!archiveOnly && <span className="archive-memory-tooltip">see older canvases</span>}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-error/20 bg-error-container/30 px-4 py-3 text-sm font-semibold text-error">
            {error}
          </div>
        )}

        <div className="md:hidden mb-8">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
            <input
              className="w-full bg-surface-container-high border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-secondary outline-none"
              placeholder="Search your library..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        {exportMode && (
          <ExportBar
            selectedCount={selectedForExport.size}
            exportOptions={exportOptions}
            onChangeOptions={setExportOptions}
            onCancel={() => {
              setExportMode(false);
              setSelectedForExport(new Set());
            }}
            onExport={handleExport}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="spinner w-8 h-8" />
          </div>
        ) : (
          <>
            {hasProjectSection && !showCanvasTreeView && (
              <>
                <SectionHeader
                  title={activeProject ? archiveOnly ? "Older Project Folders" : "Project Folders" : archiveOnly ? "Archived Projects" : "Projects"}
                  count={visibleProjects.length}
                  icon={archiveOnly ? "inventory_2" : "folder"}
                  collapsed={!activeProject && projectsCollapsed}
                  detail={archiveOnly ? "Older than 30 days or manually archived" : activeProject ? "Folders inside this project" : "Last updated within 30 days"}
                  hideToggle={Boolean(activeProject)}
                  onToggle={toggleProjectsCollapsed}
                />
                {(activeProject || !projectsCollapsed) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {visibleProjects.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        canvasCount={projectCanvasCounts.get(project.id) ?? 0}
                        menuOpen={menuOpen?.type === "project" && menuOpen.id === project.id}
                        menuAbove={menuAbove}
                        menuClosing={menuClosing}
                        menuRef={menuOpen?.type === "project" && menuOpen.id === project.id ? menuRef : undefined}
                        onOpen={() => navigateToProject(project.id)}
                        onToggleMenu={(button) => openMenu("project", project.id, button)}
                        onEdit={() => {
                          setMenuOpen(null);
                          setProjectWizard({ mode: "edit", projectId: project.id });
                        }}
                        onMove={() => {
                          setMenuOpen(null);
                          setMovingProjectId(project.id);
                        }}
                        onArchive={() => void handleArchiveProject(project)}
                        onDelete={() => void handleDeleteProject(project)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <SectionHeader
              title={activeProject ? showCanvasTreeView ? "Folder Tree" : archiveOnly ? "Project Long-Term Memory" : "Project Canvases" : archiveOnly ? "Archived Canvases" : "Canvases"}
              count={showCanvasTreeView ? visibleProjects.length + visibleCanvases.length : visibleCanvases.length}
              icon={activeProject ? showCanvasTreeView ? "account_tree" : "folder_open" : archiveOnly ? "archive" : "dashboard"}
              collapsed={!activeProject && canvasesCollapsed}
              detail={activeProject ? showCanvasTreeView ? "Folders and canvases on one canvas" : archiveOnly ? "Older than 30 days or manually archived" : "Last updated within 30 days in this folder" : archiveOnly ? "Older than 30 days or manually archived" : "Last updated within 30 days"}
              hideToggle={Boolean(activeProject)}
              onToggle={toggleCanvasesCollapsed}
            />

            {!activeProject && canvasesCollapsed ? null : showCanvasTreeView && activeProject ? (
              <DashboardCanvasTreeView
                rootProject={activeProject}
                folders={visibleProjects}
                canvases={visibleCanvases}
                projectCanvasCounts={projectCanvasCounts}
                projectFolderCounts={projectFolderCounts}
                onOpenFolder={navigateToProject}
                onOpenCanvas={(canvasId) => navigate(`/canvas/${canvasId}`)}
              />
            ) : visibleCanvases.length === 0 ? (
              <EmptyState
                search={search}
                archiveOnly={archiveOnly}
                activeProject={Boolean(activeProject)}
                hasProjects={hasProjectSection}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {visibleCanvases.map((canvas, index) => (
                  <Fragment key={canvas.id}>
                    <CanvasCard
                      canvas={canvas}
                      thumbnail={thumbnails[canvas.id]}
                      previewQueued={index < thumbnailLimit}
                      loadMoreSentinelRef={
                        index === Math.min(thumbnailLimit, visibleCanvases.length) - 1 && thumbnailLimit < visibleCanvases.length
                          ? loadMoreThumbsRef
                          : undefined
                      }
                      exportMode={exportMode}
                      isSelected={selectedForExport.has(canvas.id)}
                      isHighlighted={highlightId === canvas.id}
                      menuOpen={menuOpen?.type === "canvas" && menuOpen.id === canvas.id}
                      menuAbove={menuAbove}
                      menuClosing={menuClosing}
                      menuRef={menuOpen?.type === "canvas" && menuOpen.id === canvas.id ? menuRef : undefined}
                      onCardClick={() => {
                        if (exportMode) toggleExportSelection(canvas.id);
                        else navigate(`/canvas/${canvas.id}`);
                      }}
                      onToggleSelect={() => toggleExportSelection(canvas.id)}
                      onToggleMenu={(button) => openMenu("canvas", canvas.id, button)}
                      onEdit={() => navigate(`/canvas/${canvas.id}`)}
                      onMove={() => {
                        setMenuOpen(null);
                        setMovingCanvasId(canvas.id);
                      }}
                      onExportMarkdown={() => {
                        void loadCanvasExportData([canvas.id])
                          .then(([exportCanvas]) => exportAsMarkdown(exportCanvas))
                          .catch((err) => {
                            console.error("Failed to export canvas markdown:", err);
                            setError(err instanceof Error ? err.message : "Failed to export canvas");
                          });
                        setMenuOpen(null);
                      }}
                      onExportPng={() => {
                        void loadCanvasExportData([canvas.id])
                          .then(([exportCanvas]) => exportAsImage(exportCanvas))
                          .catch((err) => {
                            console.error("Failed to export canvas image:", err);
                            setError(err instanceof Error ? err.message : "Failed to export canvas");
                          });
                        setMenuOpen(null);
                      }}
                      onArchive={() => void handleArchiveCanvas(canvas)}
                      onDelete={() => void handleDeleteCanvas(canvas.id)}
                    />
                  </Fragment>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {!exportMode && canvases.length > 0 && (
        <button
          type="button"
          onClick={() => setExportMode(true)}
          className="fixed bottom-28 left-8 z-50 bg-secondary-fixed text-on-secondary-fixed-variant w-14 h-14 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center md:bottom-8"
          aria-label="Export canvases"
        >
          <span className="material-symbols-outlined text-2xl">download</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setShowCreateDialog(true)}
        className="fixed bottom-28 right-8 z-50 bg-gradient-to-br from-primary to-primary-container text-white w-16 h-16 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center group md:bottom-8"
        aria-label="Create new"
      >
        <span className="material-symbols-outlined text-3xl group-hover:rotate-90 transition-transform duration-300">add</span>
        <span className="absolute right-20 bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Create New
        </span>
      </button>

      {showCreateDialog && (
        <CreateChoiceDialog
          activeProject={activeProject}
          onClose={() => setShowCreateDialog(false)}
          onCreateCanvas={() => {
            setShowCreateDialog(false);
            void handleCreateCanvas();
          }}
          onCreateProject={() => {
            setShowCreateDialog(false);
            setProjectWizard({ mode: "create" });
          }}
        />
      )}

      {projectWizard && (
        <ProjectDetailsWizard
          mode={projectWizard.mode}
          project={editingProject}
          onClose={() => setProjectWizard(null)}
          onSave={(draft) => void handleSaveProject(draft)}
        />
      )}

      {movingCanvas && (
        <MoveToProjectDialog
          title={movingCanvas.title}
          mode="canvas"
          projects={projects}
          blockedIds={new Set()}
          showRootOption={Boolean(movingCanvas.project_id)}
          projectCanvasCounts={projectCanvasCounts}
          onClose={() => setMovingCanvasId(null)}
          onMove={(projectId) => void handleMoveCanvas(projectId)}
        />
      )}

      {movingProject && (
        <MoveToProjectDialog
          title={movingProject.title}
          mode="project"
          projects={projects}
          blockedIds={getProjectAndDescendantIds(movingProject.id, projects)}
          showRootOption={Boolean(movingProject.parent_project_id)}
          projectCanvasCounts={projectCanvasCounts}
          onClose={() => setMovingProjectId(null)}
          onMove={(projectId) => void handleMoveProject(projectId)}
        />
      )}

      <BottomNav />
    </div>
  );
}

function GuildCard({
  count,
  level,
  levelName,
  levelSvg,
  onClick,
}: {
  count: number;
  level: number;
  levelName: string;
  levelSvg: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="bg-surface-container-low px-6 py-4 rounded-xl flex items-center gap-4 group hover:bg-surface-container-highest transition-colors duration-300 cursor-pointer text-left">
      <div className="relative shrink-0">
        <div className="w-14 h-14 bg-tertiary-fixed rounded-full flex items-center justify-center text-on-tertiary-fixed shadow-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10 transition-transform duration-500 group-hover:scale-110 flex items-center justify-center w-full h-full">
            <svg viewBox="28 28 164 164" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full" dangerouslySetInnerHTML={{ __html: levelSvg }} />
          </div>
        </div>
        <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-surface border-[2.5px] border-surface-container-low group-hover:border-surface-container-highest transition-colors rounded-full flex items-center justify-center text-[10px] font-bold text-primary z-20 shadow-sm">
          {level}
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold font-headline">{count} {count === 1 ? "Flow" : "Flows"}</div>
        <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{levelName}</div>
      </div>
    </button>
  );
}

function StatCard({ icon, count, label, detail }: { icon: string; count: number; label: string; detail: string }) {
  return (
    <div className="bg-surface-container-low px-6 py-4 rounded-xl flex items-center gap-4">
      <span className="w-12 h-12 rounded-xl bg-tertiary-fixed text-on-tertiary-fixed flex items-center justify-center">
        <span className="material-symbols-outlined">{icon}</span>
      </span>
      <div>
        <div className="text-2xl font-bold font-headline">{count} {label}</div>
        <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{detail}</div>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  icon,
  collapsed,
  detail,
  hideToggle,
  onToggle,
}: {
  title: string;
  count: number;
  icon: string;
  collapsed: boolean;
  detail: string;
  hideToggle: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-5 mt-6">
      <span className="material-symbols-outlined text-on-surface-variant">{icon}</span>
      <h2 className="text-xl font-extrabold text-primary">{title}</h2>
      <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-bold text-on-surface-variant">{count}</span>
      <span className="text-xs font-bold text-on-surface-variant hidden sm:inline">{detail}</span>
      <div className="h-px bg-outline-variant/60 flex-1" />
      {!hideToggle && (
        <button type="button" onClick={onToggle} className="w-10 h-10 rounded-full bg-white border border-outline-variant/30 hover:bg-surface-container-low transition-colors" aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}>
          <span className="material-symbols-outlined">{collapsed ? "keyboard_arrow_down" : "keyboard_arrow_up"}</span>
        </button>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  canvasCount,
  menuOpen,
  menuAbove,
  menuClosing,
  menuRef,
  onOpen,
  onToggleMenu,
  onEdit,
  onMove,
  onArchive,
  onDelete,
}: {
  project: CanvasProject;
  canvasCount: number;
  menuOpen: boolean;
  menuAbove: boolean;
  menuClosing: boolean;
  menuRef?: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onToggleMenu: (button: HTMLButtonElement) => void;
  onEdit: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <article onClick={onOpen} className={`project-card-production project-${project.accent} group bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 relative border border-outline-variant/10 cursor-pointer p-5 min-h-[200px] overflow-visible`}>
      <div className={`project-folder-art-production project-${project.accent}`}>
        <span className="material-symbols-outlined fill">folder</span>
      </div>
      <div className="pl-28 pr-3">
        <h3 className="text-lg font-extrabold text-primary truncate" title={project.title}>{project.title}</h3>
        <p className="mt-2 text-sm text-on-surface-variant line-clamp-3">{project.description || "A project folder for related canvases."}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-on-surface-variant">
          <span className="rounded-full bg-surface-container-high px-2.5 py-1">{canvasCount} canvas{canvasCount === 1 ? "" : "es"}</span>
          <span className="rounded-full bg-surface-container-high px-2.5 py-1">Modified {timeAgo(project.updated_at)}</span>
        </div>
      </div>
      <div className="absolute left-5 bottom-4 z-40" ref={menuOpen ? menuRef : undefined}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(event.currentTarget);
          }}
          className="w-9 h-9 rounded-full bg-surface-container-high/80 text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors"
          aria-label={`Open menu for ${project.title}`}
        >
          <span className="material-symbols-outlined">more_horiz</span>
        </button>
        {menuOpen && <ProjectMenu menuAbove={menuAbove} menuClosing={menuClosing} onOpen={onOpen} onEdit={onEdit} onMove={onMove} onArchive={onArchive} onDelete={onDelete} />}
      </div>
    </article>
  );
}

function CanvasCard({
  canvas,
  thumbnail,
  previewQueued,
  loadMoreSentinelRef,
  exportMode,
  isSelected,
  isHighlighted,
  menuOpen,
  menuAbove,
  menuClosing,
  menuRef,
  onCardClick,
  onToggleSelect,
  onToggleMenu,
  onEdit,
  onMove,
  onExportMarkdown,
  onExportPng,
  onArchive,
  onDelete,
}: {
  canvas: DashboardCanvas;
  thumbnail?: string;
  previewQueued: boolean;
  loadMoreSentinelRef?: RefObject<HTMLSpanElement | null>;
  exportMode: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  menuOpen: boolean;
  menuAbove: boolean;
  menuClosing: boolean;
  menuRef?: RefObject<HTMLDivElement | null>;
  onCardClick: () => void;
  onToggleSelect: () => void;
  onToggleMenu: (button: HTMLButtonElement) => void;
  onEdit: () => void;
  onMove: () => void;
  onExportMarkdown: () => void;
  onExportPng: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={`group bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 relative border border-transparent hover:border-outline-variant/20 cursor-pointer overflow-visible${isHighlighted ? " canvas-card-highlight" : ""}${menuOpen ? " z-40" : ""}`}
      onClick={onCardClick}
    >
      {exportMode && (
        <button
          type="button"
          className={`absolute top-4 right-4 z-20 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${isSelected ? "bg-secondary border-secondary text-white" : "border-outline-variant bg-white/80"}`}
          aria-label={isSelected ? "Remove from export" : "Add to export"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect();
          }}
        >
          {isSelected && <span className="material-symbols-outlined text-sm">check</span>}
        </button>
      )}
      {loadMoreSentinelRef && <span ref={loadMoreSentinelRef} className="absolute bottom-0 left-0 h-px w-px opacity-0 pointer-events-none" aria-hidden="true" />}
      <div className="aspect-video relative overflow-hidden bg-surface-container-high rounded-t-xl">
        {canvas.is_public && (
          <div className="absolute top-3 left-3 z-20 inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/90 backdrop-blur-sm shadow-sm" title="Public">
            <span className="material-symbols-outlined text-[13px] text-white fill">public</span>
          </div>
        )}
        <div className="w-full h-full flex items-center justify-center bg-surface-container-low canvas-grid">
          {thumbnail ? (
            <div className="thumb-preview w-full h-full flex items-center justify-center p-2 pointer-events-none" dangerouslySetInnerHTML={{ __html: thumbnail }} />
          ) : previewQueued ? (
            <div className="flex flex-col items-center gap-2">
              <div className="spinner w-5 h-5" />
              <span className="text-[10px] text-on-surface-variant/50 font-medium">Rendering...</span>
            </div>
          ) : (
            <span className="material-symbols-outlined text-4xl text-outline-variant/40">account_tree</span>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="p-6">
        <div className="flex justify-between items-start mb-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-on-surface truncate" title={canvas.title}>{canvas.title}</h3>
            <p className="text-sm text-on-surface-variant">Modified {timeAgo(canvas.updated_at)}</p>
          </div>
          <div className="relative" ref={menuOpen ? menuRef : undefined}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleMenu(event.currentTarget);
              }}
              className="text-on-surface-variant hover:text-primary p-2 hover:bg-surface-container-high rounded-lg transition-colors"
              aria-label={`Open menu for ${canvas.title}`}
            >
              <span className="material-symbols-outlined">more_vert</span>
            </button>
            {menuOpen && <CanvasMenu menuAbove={menuAbove} menuClosing={menuClosing} onEdit={onEdit} onMove={onMove} onExportMarkdown={onExportMarkdown} onExportPng={onExportPng} onArchive={onArchive} onDelete={onDelete} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function CanvasMenu({
  menuAbove,
  menuClosing,
  onEdit,
  onMove,
  onExportMarkdown,
  onExportPng,
  onArchive,
  onDelete,
}: {
  menuAbove: boolean;
  menuClosing: boolean;
  onEdit: () => void;
  onMove: () => void;
  onExportMarkdown: () => void;
  onExportPng: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`absolute right-0 ${menuAbove ? "bottom-full mb-1 card-menu-above" : "top-full mt-1"} bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 min-w-[190px] z-50 card-menu-panel${menuClosing ? " card-menu-closing" : ""}`} onClick={(event) => event.stopPropagation()}>
      <MenuButton icon="edit" label="Edit" onClick={onEdit} />
      <MenuButton icon="drive_file_move" label="Move to Project" onClick={onMove} />
      <MenuButton icon="description" label="Export .md" onClick={onExportMarkdown} />
      <MenuButton icon="image" label="Export .png" onClick={onExportPng} />
      <MenuButton icon="archive" label="Archive" onClick={onArchive} />
      <MenuButton icon="delete" label="Delete" danger onClick={onDelete} />
    </div>
  );
}

function ProjectMenu({
  menuAbove,
  menuClosing,
  onOpen,
  onEdit,
  onMove,
  onArchive,
  onDelete,
}: {
  menuAbove: boolean;
  menuClosing: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`absolute left-0 ${menuAbove ? "bottom-full mb-1 card-menu-above" : "top-full mt-1"} bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 min-w-[190px] z-50 card-menu-panel${menuClosing ? " card-menu-closing" : ""}`} onClick={(event) => event.stopPropagation()}>
      <MenuButton icon="folder_open" label="Open" onClick={onOpen} />
      <MenuButton icon="edit" label="Edit" onClick={onEdit} />
      <MenuButton icon="drive_file_move" label="Move to Project" onClick={onMove} />
      <MenuButton icon="archive" label="Archive" onClick={onArchive} />
      <MenuButton icon="delete" label="Delete" danger onClick={onDelete} />
    </div>
  );
}

function MenuButton({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`card-menu-item w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 ${danger ? "text-error hover:bg-error-container/20" : ""}`}
    >
      <span className="material-symbols-outlined text-lg">{icon}</span>
      {label}
    </button>
  );
}

function CreateChoiceDialog({
  activeProject,
  onClose,
  onCreateCanvas,
  onCreateProject,
}: {
  activeProject: CanvasProject | null;
  onClose: () => void;
  onCreateCanvas: () => void;
  onCreateProject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4">
      <button type="button" className="absolute inset-0 bg-primary/30 backdrop-blur-sm" aria-label="Close create menu" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-ambient-lg p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Create</p>
            <h3 className="text-2xl font-extrabold text-primary">What would you like to start?</h3>
          </div>
          <button type="button" className="p-2 rounded-full hover:bg-surface-container-low" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="space-y-2">
          <ChoiceButton icon="draw" title="New Canvas" description={activeProject ? `Create inside ${activeProject.title}` : "Create on the root dashboard"} onClick={onCreateCanvas} />
          <ChoiceButton icon="folder" title="New Project" description={activeProject ? `Create inside ${activeProject.title}` : "Create a project folder for related canvases"} onClick={onCreateProject} fill />
        </div>
      </div>
    </div>
  );
}

function ChoiceButton({ icon, title, description, fill, onClick }: { icon: string; title: string; description: string; fill?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-4 rounded-xl px-4 py-4 text-left hover:bg-surface-container-low transition-colors">
      <span className="w-12 h-12 rounded-xl bg-surface-container-high text-primary flex items-center justify-center">
        <span className={`material-symbols-outlined ${fill ? "fill" : ""}`}>{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-on-surface">{title}</strong>
        <small className="block text-on-surface-variant">{description}</small>
      </span>
      <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
    </button>
  );
}

function ProjectDetailsWizard({
  mode,
  project,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  project: CanvasProject | null;
  onClose: () => void;
  onSave: (draft: ProjectDraft) => void;
}) {
  const [title, setTitle] = useState(project?.title ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [accent, setAccent] = useState<ProjectAccent>(project?.accent ?? "blue");
  const fallbackTitle = title.trim() || "Untitled Project";
  const fallbackDescription = description.trim() || "A project folder for related canvases.";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 md:pt-16">
      <button type="button" className="absolute inset-0 bg-primary/30 backdrop-blur-sm" aria-label="Close project details" onClick={onClose} />
      <form
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-ambient-lg"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ title: fallbackTitle, description: fallbackDescription, accent });
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 p-6 pb-4">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">{mode === "create" ? "New Project" : "Project Details"}</p>
            <h3 className="text-2xl font-extrabold text-primary">{mode === "create" ? "Set up this folder" : "Edit folder details"}</h3>
          </div>
          <button type="button" className="p-2 rounded-full hover:bg-surface-container-low" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 pb-4 pr-5 md:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-on-surface">Name</span>
              <input className="mt-2 w-full rounded-xl bg-surface-container-low border border-outline-variant/30 px-4 py-3 outline-none focus:ring-2 focus:ring-secondary" value={title} placeholder="Untitled Project" onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-on-surface">Description</span>
              <textarea className="mt-2 w-full rounded-xl bg-surface-container-low border border-outline-variant/30 px-4 py-3 outline-none focus:ring-2 focus:ring-secondary" rows={4} value={description} placeholder="A project folder for related canvases." onChange={(event) => setDescription(event.target.value)} />
            </label>
            <div>
              <span className="text-sm font-bold text-on-surface">Color</span>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {(["blue", "cyan", "green", "violet", "amber"] as const).map((color) => (
                  <button key={color} type="button" aria-pressed={accent === color} onClick={() => setAccent(color)} className={`project-color-swatch project-${color} ${accent === color ? "selected" : ""}`}>
                    <span className="material-symbols-outlined fill">folder</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={`project-preview-card project-${accent}`}>
            <span className="material-symbols-outlined fill">folder</span>
            <strong>{fallbackTitle}</strong>
            <small>{fallbackDescription}</small>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-3 border-t border-outline-variant/20 bg-white p-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-low">Cancel</button>
          <button type="submit" className="px-4 py-2 rounded-xl font-bold text-white editorial-gradient">{mode === "create" ? "Create Project" : "Save Changes"}</button>
        </div>
      </form>
    </div>
  );
}

function MoveToProjectDialog({
  title,
  mode,
  projects,
  blockedIds,
  showRootOption,
  projectCanvasCounts,
  onClose,
  onMove,
}: {
  title: string;
  mode: "canvas" | "project";
  projects: CanvasProject[];
  blockedIds: Set<string>;
  showRootOption: boolean;
  projectCanvasCounts: Map<string, number>;
  onClose: () => void;
  onMove: (projectId: string | null) => void;
}) {
  const destinations = projects.filter((project) => !blockedIds.has(project.id));
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-16 px-4">
      <button type="button" className="absolute inset-0 bg-primary/30 backdrop-blur-sm" aria-label="Close move dialog" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-ambient-lg p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Move {mode === "canvas" ? "Canvas" : "Project"}</p>
            <h3 className="text-2xl font-extrabold text-primary">Choose a destination</h3>
            <p className="text-sm text-on-surface-variant">{title}</p>
          </div>
          <button type="button" className="p-2 rounded-full hover:bg-surface-container-low" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
          {showRootOption && <ChoiceButton icon="dashboard" title="Back to Dashboard" description={`Move this ${mode} to the root dashboard`} onClick={() => onMove(null)} />}
          {destinations.map((project) => (
            <ChoiceButton
              key={project.id}
              icon="folder"
              title={project.title}
              description={`${projectCanvasCounts.get(project.id) ?? 0} canvas${(projectCanvasCounts.get(project.id) ?? 0) === 1 ? "" : "es"} · Modified ${timeAgo(project.updated_at)}`}
              onClick={() => onMove(project.id)}
              fill
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectBreadcrumb({
  path,
  action,
  onNavigate,
}: {
  path: CanvasProject[];
  action?: ReactNode;
  onNavigate: (projectId: string | null) => void;
}) {
  return (
    <div className="dashboard-folder-nav-row sticky top-[76px] z-30 -mx-2 mb-6 flex items-center gap-3 rounded-2xl bg-surface/95 px-2 py-2 backdrop-blur-xl">
      <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto text-sm font-bold text-on-surface-variant no-scrollbar" aria-label="Project breadcrumbs">
        <button type="button" className="flex shrink-0 items-center gap-1 hover:text-primary" onClick={() => onNavigate(null)}>
          <span className="material-symbols-outlined text-base">dashboard</span>
          Dashboard
        </button>
        {path.map((project, index) => (
          <span key={project.id} className="flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-base">chevron_right</span>
            <button type="button" className={`flex items-center gap-1 ${index === path.length - 1 ? "text-primary" : "hover:text-primary"}`} onClick={() => onNavigate(project.id)}>
              <span className="material-symbols-outlined fill text-base">folder</span>
              {project.title}
            </button>
          </span>
        ))}
      </nav>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function ExportBar({
  selectedCount,
  exportOptions,
  onChangeOptions,
  onCancel,
  onExport,
}: {
  selectedCount: number;
  exportOptions: { markdown: boolean; png: boolean };
  onChangeOptions: (options: { markdown: boolean; png: boolean }) => void;
  onCancel: () => void;
  onExport: () => void;
}) {
  return (
    <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between bg-secondary-fixed/30 rounded-xl px-6 py-4 gap-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-semibold text-on-surface">{selectedCount} selected</span>
        <div className="h-4 w-[1px] bg-outline-variant/30 hidden md:block" />
        <div className="flex items-center gap-4 text-sm font-medium">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={exportOptions.markdown} onChange={(event) => onChangeOptions({ ...exportOptions, markdown: event.target.checked })} className="accent-secondary w-4 h-4 rounded" />
            Markdown (.md)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={exportOptions.png} onChange={(event) => onChangeOptions({ ...exportOptions, png: event.target.checked })} className="accent-secondary w-4 h-4 rounded" />
            Image (.png)
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-3 w-full md:w-auto">
        <button type="button" onClick={onCancel} className="text-sm font-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
        <button type="button" onClick={onExport} disabled={selectedCount === 0 || (!exportOptions.markdown && !exportOptions.png)} className="px-4 py-2 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-40">Export</button>
      </div>
    </div>
  );
}

function EmptyState({ search, archiveOnly, activeProject, hasProjects }: { search: string; archiveOnly: boolean; activeProject: boolean; hasProjects: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <span className="material-symbols-outlined text-6xl text-outline-variant/40">dashboard_customize</span>
      <p className="text-on-surface-variant text-center">
        {search
          ? "No items match your search"
          : activeProject
            ? archiveOnly ? "No archived canvases inside this project." : "No current canvases inside this project yet."
            : archiveOnly ? "No canvases are archived." : hasProjects ? "No current canvases outside your project folders." : "No canvases yet. Create your first one!"}
      </p>
    </div>
  );
}

function getAvatarStage(flows: number) {
  const sorted = [...INITIAL_LEVELS].sort((a, b) => b.threshold - a.threshold);
  const current = sorted.find((level) => flows >= level.threshold) || sorted[sorted.length - 1];
  const ascending = [...INITIAL_LEVELS].sort((a, b) => a.threshold - b.threshold);
  const levelIndex = ascending.findIndex((level) => level.id === current.id) + 1;
  return { level: levelIndex, name: current.name, svg: current.svg };
}

function matchesSearch(value: string, search: string) {
  return value.toLowerCase().includes(search.trim().toLowerCase());
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getProjectAndDescendantIds(projectId: string, projects: CanvasProject[]) {
  const ids = new Set<string>([projectId]);
  let foundNewId = true;
  while (foundNewId) {
    foundNewId = false;
    for (const project of projects) {
      if (project.parent_project_id && ids.has(project.parent_project_id) && !ids.has(project.id)) {
        ids.add(project.id);
        foundNewId = true;
      }
    }
  }
  return ids;
}
