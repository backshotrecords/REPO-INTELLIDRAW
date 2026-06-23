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
  apiDeleteProjectShare,
  apiGetCanvasPreviewCodes,
  apiListCanvases,
  apiListCollaborationRoles,
  apiListGroups,
  apiListProjectShares,
  apiListProjects,
  apiRefreshProjectContext,
  apiShareProject,
  apiUpdateCanvas,
  apiUpdateProject,
  apiUpdateProjectShare,
} from "../lib/api";
import { exportAsImage, exportAsMarkdown, exportAsZip } from "../utils/export";
import { useConnectivity } from "../contexts/ConnectivityContext";
import { useMermaidThumbnails } from "../hooks/useMermaidThumbnails";
import type { CanvasProject, CollaborationCapability, CollaborationRoleSummary, DashboardCanvas, ProjectAccent, ProjectShare, UserGroup } from "../types";
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

function hasItemCapability(
  item: { access_level?: string; capabilities?: CollaborationCapability[] } | null | undefined,
  capability: CollaborationCapability,
) {
  if (!item) return false;
  if (item.access_level === "owner" || item.access_level === undefined) return true;
  return Boolean(item.capabilities?.includes(capability));
}

function getAccessRoleLabel(item: { access_level?: string; access_role_name?: string | null } | null | undefined) {
  if (!item || item.access_level === "owner" || item.access_level === undefined) return "Owner";
  return item.access_role_name || (item.access_level === "edit" ? "Can edit" : "View only");
}

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
  const [collabProjectId, setCollabProjectId] = useState<string | null>(null);
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
  const { registerReconnectHandler, setReconnectMessage } = useConnectivity();

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
  const archiveCount = useMemo(() => (
    childProjects.filter(isLongTermMemoryItem).length + scopedCanvases.filter(isLongTermMemoryItem).length
  ), [childProjects, scopedCanvases]);
  const shortTermFolderCanvasCount = scopedCanvases.filter((canvas) => !isLongTermMemoryItem(canvas)).length;
  const hasProjectSection = visibleProjects.length > 0;
  const showCanvasTreeView = Boolean(activeProject && fileViewMode === "tree");
  const movingCanvas = movingCanvasId ? canvases.find((canvas) => canvas.id === movingCanvasId) ?? null : null;
  const movingProject = movingProjectId ? projects.find((project) => project.id === movingProjectId) ?? null : null;
  const collabProject = collabProjectId ? projects.find((project) => project.id === collabProjectId) ?? null : null;
  const editingProject = projectWizard?.mode === "edit"
    ? projects.find((project) => project.id === projectWizard.projectId) ?? null
    : null;
  const isTreeWorkspace = Boolean(showCanvasTreeView && activeProject);
  const activeProjectCanCreateCanvas = !activeProject || hasItemCapability(activeProject, "canvas.create");
  const activeProjectCanCreateFolder = !activeProject || hasItemCapability(activeProject, "project.create_folder");
  const activeProjectCanCreate = activeProjectCanCreateCanvas || activeProjectCanCreateFolder;
  const activeProjectCanEditDetails = activeProject ? hasItemCapability(activeProject, "project.update") : true;
  const activeProjectCanManageShares = activeProject ? hasItemCapability(activeProject, "project.manage_shares") : false;
  const activeProjectAudienceLabel = activeProject ? getProjectAudienceLabelForPath(projectPath) : "";

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

  // Re-fetch dashboard data when the connection returns, so a load that
  // failed while offline doesn't leave a stale error behind the overlay.
  const loadDashboardRef = useRef(loadDashboard);
  useEffect(() => {
    loadDashboardRef.current = loadDashboard;
  });
  useEffect(() => {
    return registerReconnectHandler(async () => {
      setReconnectMessage("Refreshing dashboard...");
      await loadDashboardRef.current();
    });
  }, [registerReconnectHandler, setReconnectMessage]);

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
    if (!isTreeWorkspace) return;
    setExportMode(false);
    setSelectedForExport(new Set());
  }, [isTreeWorkspace]);

  useEffect(() => {
    if (!isTreeWorkspace) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousOverscrollBehavior = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    const preventTreeWheelDefault = (event: WheelEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".dashboard-tree-view")) event.preventDefault();
    };
    document.addEventListener("wheel", preventTreeWheelDefault, { capture: true, passive: false });

    return () => {
      document.removeEventListener("wheel", preventTreeWheelDefault, { capture: true });
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.documentElement.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [isTreeWorkspace]);

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

  function openUserManagement() {
    navigate("/user-management");
  }

  function refreshProjectContextInBackground(projectId: string) {
    if (projectContextRefreshesRef.current.has(projectId)) return;
    projectContextRefreshesRef.current.add(projectId);
    apiRefreshProjectContext(projectId)
      .then((result) => {
        setProjects((current) => current.map((project) => (
          project.id === result.project.id ? mergeProjectPreservingCollab(project, result.project) : project
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
    if (!activeProjectCanCreateCanvas) {
      setError("You do not have permission to create canvases in this project.");
      return;
    }
    try {
      const canvas = await apiCreateCanvas(undefined, undefined, activeProjectId);
      navigate(`/canvas/${canvas.id}`);
    } catch (err) {
      console.error("Failed to create canvas:", err);
      setError(err instanceof Error ? err.message : "Failed to create canvas");
    }
  }

  async function handleSaveProject(draft: ProjectDraft) {
    if (projectWizard?.mode === "edit" && editingProject && !hasItemCapability(editingProject, "project.update")) {
      setError("You do not have permission to edit this project.");
      return;
    }
    if (projectWizard?.mode !== "edit" && !activeProjectCanCreateFolder) {
      setError("You do not have permission to create folders in this project.");
      return;
    }
    try {
      if (projectWizard?.mode === "edit") {
        const project = await apiUpdateProject(projectWizard.projectId, draft);
        setProjects((current) => {
          const previous = current.find((item) => item.id === project.id);
          const merged = previous ? mergeProjectPreservingCollab(previous, project) : project;
          return [merged, ...current.filter((item) => item.id !== project.id)];
        });
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
      setProjects((current) => current.map((item) => item.id === updated.id ? mergeProjectPreservingCollab(item, updated) : item));
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
      setProjects((current) => {
        const previous = current.find((project) => project.id === updated.id);
        const merged = previous ? mergeProjectPreservingCollab(previous, updated) : updated;
        return [merged, ...current.filter((project) => project.id !== updated.id)];
      });
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
    <div className={`dashboard-page bg-surface text-on-surface min-h-screen${isTreeWorkspace ? " dashboard-page-tree-mode" : " pb-32"}`}>
      <TopBar showSearch searchVisibility="desktop" onSearchChange={setSearch} />

      <main className={`dashboard-main mx-auto px-6 pt-8${isTreeWorkspace ? " dashboard-main-tree-mode max-w-none" : " max-w-7xl"}`}>
        {projectPath.length > 0 && (
          <ProjectBreadcrumb
            path={projectPath}
            audienceLabel={isTreeWorkspace ? activeProjectAudienceLabel : ""}
            onOpenUserManagement={openUserManagement}
            onNavigate={navigateToProject}
            action={<DashboardFileViewToggle mode={fileViewMode} onChange={setFileViewMode} />}
          />
        )}

        <div className={`dashboard-project-summary flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10${isTreeWorkspace ? " is-hidden" : ""}`} aria-hidden={isTreeWorkspace}>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-5xl font-extrabold tracking-tight text-primary font-headline">
                {activeProject?.title ?? "My Canvases"}
              </h1>
              {activeProject && (
                <>
                  <button
                    type="button"
                    aria-label="Edit project details"
                    title="Edit project details"
                    disabled={!activeProjectCanEditDetails}
                    onClick={() => setProjectWizard({ mode: "edit", projectId: activeProject.id })}
                    className="w-10 h-10 rounded-full bg-surface-container-lowest border border-outline-variant/30 shadow-sm hover:bg-surface-container-low flex items-center justify-center text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <span className="material-symbols-outlined text-[22px]">edit</span>
                  </button>
                  {activeProjectCanManageShares ? (
                    <button
                      type="button"
                      aria-label="Manage project collaboration"
                      title="Manage project collaboration"
                      onClick={() => setCollabProjectId(activeProject.id)}
                      className="w-10 h-10 rounded-full bg-surface-container-lowest border border-outline-variant/30 shadow-sm hover:bg-surface-container-low flex items-center justify-center text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-[22px]">groups</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary-fixed/50 px-3 py-2 text-xs font-bold text-primary">
                      <span className="material-symbols-outlined text-base">groups</span>
                      {getAccessRoleLabel(activeProject)}
                    </span>
                  )}
                </>
              )}
            </div>
            <p className="text-on-surface-variant max-w-md">
              {activeProject?.description || "Precision diagrams curated by your master drafter AI. Organize, edit, and export your architectural flows."}
            </p>
            {activeProjectAudienceLabel && (
              <div className="mt-4">
                <CollabProjectAudience label={activeProjectAudienceLabel} onOpenUserManagement={openUserManagement} />
              </div>
            )}
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

        {!isTreeWorkspace && <div className="md:hidden mb-8">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
            <input
              className="w-full bg-surface-container-high border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-secondary outline-none"
              placeholder="Search your library..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>}

        {!isTreeWorkspace && exportMode && (
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
          <div className={isTreeWorkspace ? "dashboard-tree-loading" : "flex items-center justify-center py-20"}>
            <div className="spinner w-8 h-8" />
          </div>
        ) : (
          <div className={isTreeWorkspace ? "dashboard-tree-content" : ""}>
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
                        onOpenUserManagement={openUserManagement}
                        onToggleMenu={(button) => openMenu("project", project.id, button)}
                        onEdit={() => {
                          setMenuOpen(null);
                          setProjectWizard({ mode: "edit", projectId: project.id });
                        }}
                        onCollaborate={() => {
                          setMenuOpen(null);
                          setCollabProjectId(project.id);
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

            {!showCanvasTreeView && (
              <SectionHeader
                title={activeProject ? archiveOnly ? "Project Long-Term Memory" : "Project Canvases" : archiveOnly ? "Archived Canvases" : "Canvases"}
                count={visibleCanvases.length}
                icon={activeProject ? "folder_open" : archiveOnly ? "archive" : "dashboard"}
                collapsed={!activeProject && canvasesCollapsed}
                detail={activeProject ? archiveOnly ? "Older than 30 days or manually archived" : "Last updated within 30 days in this folder" : archiveOnly ? "Older than 30 days or manually archived" : "Last updated within 30 days"}
                hideToggle={Boolean(activeProject)}
                onToggle={toggleCanvasesCollapsed}
              />
            )}

            {!activeProject && canvasesCollapsed ? null : showCanvasTreeView && activeProject ? (
              <DashboardCanvasTreeView
                key={activeProject.id}
                rootProject={activeProject}
                folders={projects}
                canvases={canvases}
                archiveOnly={archiveOnly}
                search={search}
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
          </div>
        )}
      </main>

      {!isTreeWorkspace && !exportMode && canvases.length > 0 && (
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
        onClick={() => {
          if (!activeProjectCanCreate) {
            setError("You do not have permission to create items in this project.");
            return;
          }
          setShowCreateDialog(true);
        }}
        className={`fixed bottom-28 right-8 z-50 bg-gradient-to-br from-primary to-primary-container text-white w-16 h-16 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center group md:bottom-8${activeProjectCanCreate ? "" : " opacity-50"}`}
        aria-label={activeProjectCanCreate ? "Create new" : "No create permission"}
      >
        <span className="material-symbols-outlined text-3xl group-hover:rotate-90 transition-transform duration-300">add</span>
        <span className="absolute right-20 bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Create New
        </span>
      </button>

      {showCreateDialog && (
        <CreateChoiceDialog
          activeProject={activeProject}
          canCreateCanvas={activeProjectCanCreateCanvas}
          canCreateProject={activeProjectCanCreateFolder}
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
          showRootOption={Boolean(movingCanvas.project_id) && movingCanvas.access_level !== "edit" && movingCanvas.access_level !== "view"}
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
          showRootOption={Boolean(movingProject.parent_project_id) && movingProject.access_level !== "edit" && movingProject.access_level !== "view"}
          projectCanvasCounts={projectCanvasCounts}
          onClose={() => setMovingProjectId(null)}
          onMove={(projectId) => void handleMoveProject(projectId)}
        />
      )}

      {collabProject && (
        <ProjectCollabDialog
          project={collabProject}
          onClose={() => setCollabProjectId(null)}
          onChanged={() => void loadDashboard()}
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
  onOpenUserManagement,
  onToggleMenu,
  onEdit,
  onCollaborate,
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
  onOpenUserManagement: () => void;
  onToggleMenu: (button: HTMLButtonElement) => void;
  onEdit: () => void;
  onCollaborate: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const isShared = project.access_level === "view" || project.access_level === "edit";
  const projectAudienceLabel = getProjectAudienceLabel(project);
  const hasCollabSignal = isShared || Boolean(projectAudienceLabel);
  const canEdit = hasItemCapability(project, "project.update");
  const canManageShares = hasItemCapability(project, "project.manage_shares");
  const canMove = hasItemCapability(project, "project.move");
  const canArchive = hasItemCapability(project, "project.archive");
  const canDelete = hasItemCapability(project, "project.delete");

  return (
    <article onClick={onOpen} className={`project-card-production project-${project.accent}${hasCollabSignal ? " is-collab-project" : ""} group bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 relative border border-outline-variant/10 cursor-pointer p-5 min-h-[200px] overflow-visible${menuOpen ? " z-40" : ""}`}>
      <div className={`project-folder-art-production project-${project.accent}`}>
        <span className="material-symbols-outlined fill">folder</span>
      </div>
      <div className="pl-28 pr-3 min-h-[160px] flex flex-col">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-extrabold text-primary truncate" title={project.title}>{project.title}</h3>
          {hasCollabSignal && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-secondary-fixed/55 px-2 py-0.5 text-[10px] font-black uppercase text-primary">
              <span className="material-symbols-outlined text-[13px]">groups</span>
              Collab
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-on-surface-variant line-clamp-3">{project.description || "A project folder for related canvases."}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-on-surface-variant">
          <span className="rounded-full bg-surface-container-high px-2.5 py-1">{canvasCount} canvas{canvasCount === 1 ? "" : "es"}</span>
          <span className="rounded-full bg-surface-container-high px-2.5 py-1">Modified {timeAgo(project.updated_at)}</span>
          {isShared && (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">
              {getAccessRoleLabel(project)}
            </span>
          )}
        </div>
        {projectAudienceLabel && (
          <div className="mt-auto pt-4">
            <CollabProjectAudience label={projectAudienceLabel} onOpenUserManagement={onOpenUserManagement} />
          </div>
        )}
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
        {menuOpen && (
          <ProjectMenu
            menuAbove={menuAbove}
            menuClosing={menuClosing}
            canEdit={canEdit}
            canManageShares={canManageShares}
            canMove={canMove}
            canArchive={canArchive}
            canDelete={canDelete}
            onOpen={onOpen}
            onEdit={onEdit}
            onCollaborate={onCollaborate}
            onMove={onMove}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        )}
      </div>
    </article>
  );
}

function getProjectAudienceLabel(project: CanvasProject) {
  if ((project.access_level === "view" || project.access_level === "edit") && project.shared_via_group_name) {
    return `Shared via ${project.shared_via_group_name}`;
  }

  const count = project.shared_with_group_count ?? 0;
  if (count <= 0) return "";

  const names = project.shared_with_group_names ?? [];
  const firstName = names[0];
  if (!firstName) return `Shared with ${count} group${count === 1 ? "" : "s"}`;
  if (count === 1) return `Shared with ${firstName}`;
  return `Shared with ${firstName} + ${count - 1}`;
}

function getProjectAudienceLabelForPath(path: CanvasProject[]) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const label = getProjectAudienceLabel(path[index]);
    if (label) return label;
  }
  return "";
}

function mergeProjectPreservingCollab(current: CanvasProject, incoming: CanvasProject): CanvasProject {
  return {
    ...current,
    ...incoming,
    access_level: incoming.access_level ?? current.access_level,
    access_role_id: incoming.access_role_id ?? current.access_role_id,
    access_role_name: incoming.access_role_name ?? current.access_role_name,
    capabilities: incoming.capabilities ?? current.capabilities,
    shared_root_project_id: incoming.shared_root_project_id ?? current.shared_root_project_id,
    shared_via_group_id: incoming.shared_via_group_id ?? current.shared_via_group_id,
    shared_via_group_name: incoming.shared_via_group_name ?? current.shared_via_group_name,
    shared_with_group_count: incoming.shared_with_group_count ?? current.shared_with_group_count,
    shared_with_group_names: incoming.shared_with_group_names ?? current.shared_with_group_names,
  };
}

function CollabProjectAudience({ label, onOpenUserManagement }: { label: string; onOpenUserManagement?: () => void }) {
  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onOpenUserManagement?.();
  }

  return (
    <button
      type="button"
      className="project-collab-audience"
      title={`${label}. Open user management.`}
      aria-label={`${label}. Open user management.`}
      onClick={handleClick}
    >
      <span className="project-collab-avatar-stack" aria-hidden="true">
        <span className="project-collab-avatar-dot" />
        <span className="project-collab-avatar-dot" />
        <span className="project-collab-avatar-dot" />
      </span>
      <span className="truncate">{label}</span>
    </button>
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
  const isShared = canvas.access_level === "view" || canvas.access_level === "edit";
  const canEdit = hasItemCapability(canvas, "canvas.update");
  const canMove = hasItemCapability(canvas, "canvas.move");
  const canArchive = hasItemCapability(canvas, "canvas.archive");
  const canDelete = hasItemCapability(canvas, "canvas.delete");

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
        {isShared && (
          <div className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[10px] font-black uppercase text-primary shadow-sm" title={getAccessRoleLabel(canvas)}>
            <span className="material-symbols-outlined text-[13px]">groups</span>
            {getAccessRoleLabel(canvas)}
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
            {menuOpen && (
              <CanvasMenu
                menuAbove={menuAbove}
                menuClosing={menuClosing}
                canEdit={canEdit}
                canMove={canMove}
                canArchive={canArchive}
                canDelete={canDelete}
                onEdit={onEdit}
                onMove={onMove}
                onExportMarkdown={onExportMarkdown}
                onExportPng={onExportPng}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function CanvasMenu({
  menuAbove,
  menuClosing,
  canEdit,
  canMove,
  canArchive,
  canDelete,
  onEdit,
  onMove,
  onExportMarkdown,
  onExportPng,
  onArchive,
  onDelete,
}: {
  menuAbove: boolean;
  menuClosing: boolean;
  canEdit: boolean;
  canMove: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onMove: () => void;
  onExportMarkdown: () => void;
  onExportPng: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`absolute right-0 ${menuAbove ? "bottom-full mb-1 card-menu-above" : "top-full mt-1"} bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 min-w-[190px] z-50 card-menu-panel${menuClosing ? " card-menu-closing" : ""}`} onClick={(event) => event.stopPropagation()}>
      <MenuButton icon={canEdit ? "edit" : "visibility"} label={canEdit ? "Edit" : "Open View Only"} onClick={onEdit} />
      {canMove && <MenuButton icon="drive_file_move" label="Move to Project" onClick={onMove} />}
      <MenuButton icon="description" label="Export .md" onClick={onExportMarkdown} />
      <MenuButton icon="image" label="Export .png" onClick={onExportPng} />
      {canArchive && <MenuButton icon="archive" label="Archive" onClick={onArchive} />}
      {canDelete && <MenuButton icon="delete" label="Delete" danger onClick={onDelete} />}
    </div>
  );
}

function ProjectMenu({
  menuAbove,
  menuClosing,
  canEdit,
  canManageShares,
  canMove,
  canArchive,
  canDelete,
  onOpen,
  onEdit,
  onCollaborate,
  onMove,
  onArchive,
  onDelete,
}: {
  menuAbove: boolean;
  menuClosing: boolean;
  canEdit: boolean;
  canManageShares: boolean;
  canMove: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onCollaborate: () => void;
  onMove: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`absolute left-0 ${menuAbove ? "bottom-full mb-1 card-menu-above" : "top-full mt-1"} bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 min-w-[190px] z-50 card-menu-panel${menuClosing ? " card-menu-closing" : ""}`} onClick={(event) => event.stopPropagation()}>
      <MenuButton icon="folder_open" label="Open" onClick={onOpen} />
      {canEdit && <MenuButton icon="edit" label="Edit" onClick={onEdit} />}
      {canManageShares && <MenuButton icon="groups" label="Collaborate" onClick={onCollaborate} />}
      {canMove && <MenuButton icon="drive_file_move" label="Move to Project" onClick={onMove} />}
      {canArchive && <MenuButton icon="archive" label="Archive" onClick={onArchive} />}
      {canDelete && <MenuButton icon="delete" label="Delete" danger onClick={onDelete} />}
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
  canCreateCanvas,
  canCreateProject,
  onClose,
  onCreateCanvas,
  onCreateProject,
}: {
  activeProject: CanvasProject | null;
  canCreateCanvas: boolean;
  canCreateProject: boolean;
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
          {canCreateCanvas && (
            <ChoiceButton icon="draw" title="New Canvas" description={activeProject ? `Create inside ${activeProject.title}` : "Create on the root dashboard"} onClick={onCreateCanvas} />
          )}
          {canCreateProject && (
            <ChoiceButton icon="folder" title="New Project" description={activeProject ? `Create inside ${activeProject.title}` : "Create a project folder for related canvases"} onClick={onCreateProject} fill />
          )}
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

function ProjectCollabDialog({
  project,
  onClose,
  onChanged,
}: {
  project: CanvasProject;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [roles, setRoles] = useState<CollaborationRoleSummary[]>([]);
  const [groupId, setGroupId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadCollabState() {
    setLoading(true);
    setError("");
    try {
      const [groupData, shareData, roleData] = await Promise.all([
        apiListGroups(),
        apiListProjectShares(project.id),
        apiListCollaborationRoles(),
      ]);
      setGroups((groupData as UserGroup[]).filter((group) => group.owner_id === project.user_id));
      setShares(shareData);
      setRoles(roleData);
      setRoleId((current) => current || roleData[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collaboration settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCollabState();
  }, [project.id]);

  async function handleShare() {
    if (!groupId || !roleId) return;
    setSaving(true);
    setError("");
    try {
      await apiShareProject(project.id, groupId, roleId);
      setGroupId("");
      await loadCollabState();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share project");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateShare(share: ProjectShare, nextRoleId: string) {
    if (!nextRoleId || nextRoleId === share.role_id) return;
    setSaving(true);
    setError("");
    try {
      await apiUpdateProjectShare(project.id, share.id, nextRoleId);
      await loadCollabState();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update share");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveShare(share: ProjectShare) {
    setSaving(true);
    setError("");
    try {
      await apiDeleteProjectShare(project.id, share.id);
      await loadCollabState();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove share");
    } finally {
      setSaving(false);
    }
  }

  const sharedGroupIds = new Set(shares.map((share) => share.shared_with_group_id));
  const availableGroups = groups.filter((group) => !sharedGroupIds.has(group.id));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const describeShareRole = (share: ProjectShare) => {
    const role = share.role_id ? roleById.get(share.role_id) ?? share.collaboration_roles : share.collaboration_roles;
    if (role?.name) return role.name;
    return share.access_level === "edit" ? "Editor" : "Viewer";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 md:pt-16">
      <button type="button" className="absolute inset-0 bg-primary/30 backdrop-blur-sm" aria-label="Close collaboration settings" onClick={onClose} />
      <section className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-ambient-lg">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant/15 p-6">
          <div>
            <p className="text-xs uppercase tracking-widest font-bold text-on-surface-variant">Project Collaboration</p>
            <h3 className="text-2xl font-extrabold text-primary">{project.title}</h3>
          </div>
          <button type="button" className="p-2 rounded-full hover:bg-surface-container-low" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-error/20 bg-error-container/30 px-4 py-3 text-sm font-semibold text-error">
              {error}
            </div>
          )}

          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-end">
              <label className="block">
                <span className="text-sm font-bold text-on-surface">Group</span>
                <select
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  className="mt-2 w-full rounded-xl bg-white border border-outline-variant/30 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary"
                  disabled={loading || saving || availableGroups.length === 0}
                >
                  <option value="">{availableGroups.length === 0 ? "No available groups" : "Select a group"}</option>
                  {availableGroups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-bold text-on-surface">Role</span>
                <select
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                  className="mt-2 w-full rounded-xl bg-white border border-outline-variant/30 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary"
                  disabled={loading || saving || roles.length === 0}
                >
                  <option value="">{roles.length === 0 ? "No roles available" : "Select a role"}</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={!groupId || !roleId || saving}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-lg">group_add</span>
              Share Project
            </button>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-extrabold text-primary">Current access</h4>
            {loading ? (
              <div className="flex justify-center rounded-xl border border-outline-variant/15 p-8">
                <div className="spinner w-6 h-6" />
              </div>
            ) : shares.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant/30 p-6 text-center text-sm text-on-surface-variant">
                This project is not shared with any groups yet.
              </div>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="flex flex-col gap-3 rounded-xl border border-outline-variant/15 bg-white p-4 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <span className="material-symbols-outlined">groups</span>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-on-surface">{share.user_groups?.name || "Group"}</p>
                      <p className="text-xs font-semibold text-on-surface-variant">{describeShareRole(share)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={share.role_id || ""}
                      onChange={(event) => void handleUpdateShare(share, event.target.value)}
                      disabled={saving}
                      className="rounded-xl border border-outline-variant/20 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-40"
                    >
                      <option value="">{describeShareRole(share)}</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleRemoveShare(share)}
                      disabled={saving}
                      className="rounded-xl px-3 py-2 text-xs font-bold text-error hover:bg-error-container/20 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
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
  const destinations = projects.filter((project) => {
    if (blockedIds.has(project.id)) return false;
    return mode === "canvas"
      ? hasItemCapability(project, "canvas.create")
      : hasItemCapability(project, "project.create_folder");
  });
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
  audienceLabel,
  action,
  onOpenUserManagement,
  onNavigate,
}: {
  path: CanvasProject[];
  audienceLabel?: string;
  action?: ReactNode;
  onOpenUserManagement: () => void;
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
      {audienceLabel && (
        <div className="hidden min-w-0 shrink md:block">
          <CollabProjectAudience label={audienceLabel} onOpenUserManagement={onOpenUserManagement} />
        </div>
      )}
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
