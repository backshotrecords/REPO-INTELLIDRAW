import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MermaidRenderer, { extractNodeId } from "../components/MermaidRenderer";
import NodeActionOverlay from "../components/NodeActionOverlay";
import type { NodeAction } from "../components/NodeActionOverlay";
import ProfileMenu from "../components/ProfileMenu";
import VoiceMicButton from "../components/VoiceMicButton";
import AgentGitLog from "../components/AgentGitLog";
import CanvasSkillsPanel from "../components/CanvasSkillsPanel";
import { apiGetCanvas, apiCreateCanvas, apiUpdateCanvas, apiDeleteCanvas, apiChat, apiUploadFile, apiGetActiveRules, apiPublishCanvas, apiSuggestCanvasName, apiGetCommits, apiCreateCommit } from "../lib/api";
import { getSoundSettings, fetchSoundSettings } from "../lib/soundSettings";
import { getCanvasSettings, fetchCanvasSettings } from "../lib/canvasSettings";
import type { ChatMessage, CanvasCommit } from "../types";

const DEFAULT_MERMAID_CODE = "flowchart TD\n    A[Start] --> B[Next Step]";

/** Selected node info stored as a pill */
interface SelectedNode {
  id: string;
  label: string;
  codeDefinition: string;
}

/**
 * Parse the mermaid source code to find the full node definition for a given node ID.
 * Handles shapes: [] () {} {{}} [()] etc.
 * Falls back to "ID" if no definition line is found.
 */
function findNodeDefinition(mermaidCode: string, nodeId: string): string {
  // Escape special regex chars in the node ID
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the node ID followed by a shape opener: [ ( { or "
  const regex = new RegExp(`^\\s*${escaped}\\s*([\\[\\(\\{"<])`, "m");
  const match = mermaidCode.match(regex);
  if (!match) return nodeId;

  // Found the start — now extract the full definition up to end of line
  const startIdx = mermaidCode.indexOf(match[0]);
  const lineEnd = mermaidCode.indexOf("\n", startIdx);
  const line = lineEnd === -1
    ? mermaidCode.slice(startIdx).trim()
    : mermaidCode.slice(startIdx, lineEnd).trim();

  return line;
}

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [canvasId, setCanvasId] = useState<string | null>(id === "new" ? null : id || null);
  const [title, setTitle] = useState("Untitled Canvas");
  const [mermaidCode, setMermaidCode] = useState(DEFAULT_MERMAID_CODE);
  const [isNaming, setIsNaming] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [commits, setCommits] = useState<CanvasCommit[]>([]);
  const [activeView, setActiveView] = useState<"flowchart" | "code">("flowchart");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Ref mirrors — sendMessage reads these instead of closures (closure-proof)
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const mermaidCodeRef = useRef(DEFAULT_MERMAID_CODE);
  const chatLoadingRef = useRef(false);

  useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);
  useEffect(() => { mermaidCodeRef.current = mermaidCode; }, [mermaidCode]);
  useEffect(() => { chatLoadingRef.current = chatLoading; }, [chatLoading]);
  const [showChat, setShowChat] = useState(false);
  const [showSkillsPanel, setShowSkillsPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareExiting, setShareExiting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);

  // ── Node selection state ──
  const [activeNode, setActiveNode] = useState<{
    id: string;
    label: string;
    codeDefinition: string;
    rect: DOMRect;
  } | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<SelectedNode[]>([]);
  const [flashPillId, setFlashPillId] = useState<string | null>(null);
  const [inputBarHeight, setInputBarHeight] = useState(60);

  // Preview Mode state — version browsing without committing
  const [previewMode, setPreviewMode] = useState(false);
  const [previewVersionNumber, setPreviewVersionNumber] = useState<number | null>(null);
  const latestMermaidCodeRef = useRef(DEFAULT_MERMAID_CODE);
  // Ref mirrors for closure-proof access in sendMessage / flushPreviewMode
  const previewModeRef = useRef(false);
  const previewVersionNumberRef = useRef<number | null>(null);
  useEffect(() => { previewModeRef.current = previewMode; }, [previewMode]);
  useEffect(() => { previewVersionNumberRef.current = previewVersionNumber; }, [previewVersionNumber]);

  // Canvas pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const [isPanningVisual, setIsPanningVisual] = useState(false); // drives cursor style only
  const lastPanPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const codeOnEnterRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);

  // Fetch global sound config from server on mount (populates in-memory cache)
  useEffect(() => {
    fetchSoundSettings();
    fetchCanvasSettings();
  }, []);

  // Sound notification for canvas updates — reads from cached server config
  const playCanvasSound = useCallback(() => {
    const settings = getSoundSettings();
    if (!settings.enabled || settings.volume === 0) return;
    try {
      const audio = new Audio(settings.soundUrl);
      audio.volume = settings.volume;
      audio.play().catch(() => { /* browser autoplay policy */ });
    } catch { /* invalid URL or audio */ }
  }, []);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Load canvas
  const loadCanvas = useCallback(async (canvasId: string) => {
    try {
      const canvas = await apiGetCanvas(canvasId);
      setCanvasId(canvas.id);
      setTitle(canvas.title);
      setMermaidCode(canvas.mermaid_code);
      latestMermaidCodeRef.current = canvas.mermaid_code;
      setChatHistory(canvas.chat_history || []);
      setIsPublic(canvas.is_public || false);

      // Load commits for the Git Tree (independent of chat history)
      try {
        const commitsList = await apiGetCommits(canvas.id);
        setCommits(commitsList || []);
      } catch (commitErr) {
        console.error("Failed to load commits:", commitErr);
      }
    } catch (err) {
      console.error("Failed to load canvas:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      alert(`Failed to load canvas: ${message}`);
      navigate("/dashboard");
    }
  }, [navigate]);

  const createNewCanvas = useCallback(async () => {
    try {
      const canvas = await apiCreateCanvas();
      setCanvasId(canvas.id);
      setTitle(canvas.title);
      setMermaidCode(canvas.mermaid_code);
      navigate(`/canvas/${canvas.id}`, { replace: true });
    } catch (err) {
      console.error("Failed to create canvas:", err);
    }
  }, [navigate]);

  useEffect(() => {
    if (id && id !== "new") {
      loadCanvas(id);
    } else if (id === "new") {
      createNewCanvas();
    }
  }, [id, loadCanvas, createNewCanvas]);



  // Track input bar height for dynamic floating button positioning
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setInputBarHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-resize textarea whenever chatInput changes (from any source)
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxH = 20 * 8; // ~8 lines
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px';
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [chatInput]);

  // Auto-save with 2-second debounce
  const autoSave = useCallback(
    (code: string, history?: ChatMessage[]) => {
      if (!canvasId) return;
      if (previewModeRef.current) return; // Don't persist previewed state
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          const updates: Record<string, unknown> = { mermaidCode: code };
          if (history) updates.chatHistory = history;
          await apiUpdateCanvas(canvasId, updates);
        } catch (err) {
          console.error("Auto-save failed:", err);
        } finally {
          setSaving(false);
        }
      }, 2000);
    },
    [canvasId]
  );

  // ── Create a commit (fire-and-forget, appends locally + to DB) ──
  const createCommit = useCallback(async (
    code: string,
    source: string,
    commitMessage: string
  ) => {
    if (!canvasId) return;

    // Track the latest committed code for preview-mode revert
    latestMermaidCodeRef.current = code;

    // Optimistic: append locally immediately so Git Tree updates instantly
    const optimistic: CanvasCommit = {
      id: crypto.randomUUID(),
      canvas_id: canvasId,
      mermaid_code: code,
      source,
      commit_message: commitMessage,
      created_at: new Date().toISOString(),
    };
    setCommits(prev => [...prev, optimistic]);

    // Persist to DB (fire-and-forget — don't block the UI)
    try {
      await apiCreateCommit(canvasId, code, source, commitMessage);
    } catch (err) {
      console.error("Failed to persist commit:", err);
    }
  }, [canvasId]);

  // ── Flush preview mode — creates anchor commit when user makes a real change ──
  const flushPreviewMode = useCallback(() => {
    if (!previewModeRef.current || previewVersionNumberRef.current === null) return;

    const anchorCode = mermaidCodeRef.current; // the previewed code on canvas
    const vNum = previewVersionNumberRef.current;
    const commitMsg = vNum > 0
      ? `Restored to version ${vNum}`
      : "Restored to a previous version";

    // Anchor commit: record the restore in the Git Tree
    createCommit(anchorCode, "restore", commitMsg);

    // Insert a chat message explaining the restore (include mermaid code so the AI knows the current state)
    const restoreLabel = vNum > 0 ? `version ${vNum}` : "a previous version";
    const restoreMsg: ChatMessage = {
      role: "assistant",
      content: `↩️ Restored to ${restoreLabel}. The current flowchart is now:\n\n\`\`\`mermaid\n${anchorCode}\n\`\`\``,
      timestamp: new Date().toISOString(),
      versionSource: "restore",
    };
    const newHistory = [...chatHistoryRef.current, restoreMsg];
    setChatHistory(newHistory);
    chatHistoryRef.current = newHistory; // Sync ref immediately so sendMessage reads correct history

    // Persist the anchor state (autoSave still checks previewModeRef, so clear it first)
    previewModeRef.current = false;
    setPreviewMode(false);
    setPreviewVersionNumber(null);
    previewVersionNumberRef.current = null;

    autoSave(anchorCode, newHistory);
  }, [createCommit, autoSave]);

  const handleSyntaxError = useCallback(async (_errorMsg: string, brokenCode: string) => {
    if (isFixing || chatLoading) return;
    flushPreviewMode();
    setIsFixing(true);
    setChatLoading(true);

    const helperMessage: ChatMessage = {
      role: "assistant",
      content: "⚡ Hold on, I noticed a syntax error in the flowchart. Debugging it right now...",
      timestamp: new Date().toISOString(),
    };

    // Flag the last user message as the culprit for analytics
    const updatedHistoryForFix = [...chatHistory];
    for (let i = updatedHistoryForFix.length - 1; i >= 0; i--) {
      if (updatedHistoryForFix[i].role === "user") {
        updatedHistoryForFix[i] = { ...updatedHistoryForFix[i], causedCrash: true };
        break;
      }
    }
    updatedHistoryForFix.push(helperMessage);

    setChatHistory(updatedHistoryForFix);
    // Force a save to persist the crash flag to the DB immediately
    autoSave(brokenCode, updatedHistoryForFix);

    try {
      // Fetch admin sanitization rules
      const rules = await apiGetActiveRules();
      let fixMessage = "The mermaid code has syntax errors that are crashing the renderer. Please rewrite the entire mermaid code, fixing any syntax issues like unescaped parentheses, brackets, or special characters in node labels. Return the complete corrected mermaid code.";

      if (rules.length > 0) {
        fixMessage += "\n\nAlso apply these sanitization rules:\n" + rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
      }

      const result = await apiChat(fixMessage, brokenCode, updatedHistoryForFix);

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.updatedMermaidCode
          ? "✅ Fixed! The flowchart has been repaired and updated."
          : result.response,
        timestamp: new Date().toISOString(),
      };
      setChatHistory((prev) => [...prev, assistantMessage]);

      if (result.updatedMermaidCode) {
        // Apply directly to canvas — no pending button
        setMermaidCode(result.updatedMermaidCode);
        playCanvasSound();
        autoSave(result.updatedMermaidCode);
        createCommit(result.updatedMermaidCode, "auto_fix", "Auto-fixed syntax error");
      }
    } catch (err) {
      console.error("Auto-fix failed:", err);
      const errMessage: ChatMessage = {
        role: "assistant",
        content: "⚠️ The auto-fix attempt failed. Please try again or edit the code manually.",
        timestamp: new Date().toISOString(),
      };
      setChatHistory((prev) => [...prev, errMessage]);
    } finally {
      setIsFixing(false);
      setChatLoading(false);
    }
  }, [isFixing, chatLoading, chatHistory, autoSave, createCommit, flushPreviewMode]);

  const handleMermaidCodeChange = (newCode: string) => {
    setMermaidCode(newCode);
    autoSave(newCode);
  };

  const handleTitleSave = async () => {
    setEditingTitle(false);
    if (!canvasId) return;
    try {
      await apiUpdateCanvas(canvasId, { title });
    } catch (err) {
      console.error("Failed to save title:", err);
    }
  };

  // Restore a version from the git log — enters Preview Mode (no commit until user makes a change)
  const handleRestoreVersion = (snapshot: string, versionNumber: number) => {
    setMermaidCode(snapshot);

    // If restoring to the latest version, exit preview mode
    if (snapshot === latestMermaidCodeRef.current) {
      setPreviewMode(false);
      setPreviewVersionNumber(null);
      return;
    }

    // Enter preview mode — no commit, no autosave, no chat message
    setPreviewMode(true);
    setPreviewVersionNumber(versionNumber);
  };

  // Manual edit tracking on view switch
  const handleViewSwitch = (view: "flowchart" | "code") => {
    if (view === "code" && activeView !== "code") {
      codeOnEnterRef.current = mermaidCode;
    } else if (view === "flowchart" && activeView === "code") {
      if (mermaidCode !== codeOnEnterRef.current) {
        flushPreviewMode();
        const manualMsg: ChatMessage = {
          role: "assistant",
          content: "✏️ Canvas updated via code editor",
          timestamp: new Date().toISOString(),
        };
        const newHistory = [...chatHistoryRef.current, manualMsg];
        setChatHistory(newHistory);
        autoSave(mermaidCode, newHistory);
        createCommit(mermaidCode, "manual", "Manual code edit");
      }
    }
    setActiveView(view);
  };

  // Publish toggle (extracted for header + sidebar)
  const handlePublishToggle = async () => {
    if (!canvasId || publishing) return;
    setPublishing(true);
    try {
      await apiPublishCanvas(canvasId, !isPublic);
      setIsPublic(!isPublic);
    } catch (err) {
      console.error("Publish toggle failed:", err);
    } finally {
      setPublishing(false);
    }
  };

  // Navigate back to dashboard with intelligent naming / blank-canvas cleanup
  const handleCanvasExit = useCallback(async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;

    if (!canvasId) {
      navigate("/dashboard");
      return;
    }

    // If previewing, discard the preview — revert to the real latest code
    if (previewModeRef.current) {
      setMermaidCode(latestMermaidCodeRef.current);
      setPreviewMode(false);
      setPreviewVersionNumber(null);
    }

    // Use the latest committed code for the blank-canvas check (not the previewed code)
    const hasChanges = latestMermaidCodeRef.current.trim() !== DEFAULT_MERMAID_CODE.trim();

    if (!hasChanges) {
      // No edits — delete the blank canvas silently
      try {
        await apiDeleteCanvas(canvasId);
      } catch (err) {
        console.error("Failed to delete blank canvas:", err);
      }
      navigate("/dashboard");
      return;
    }

    // Canvas has changes — check if it still has the default name
    if (title === "Untitled Canvas") {
      setIsNaming(true);
      try {
        const suggestedName = await apiSuggestCanvasName(latestMermaidCodeRef.current);
        if (suggestedName && suggestedName !== "Untitled Canvas") {
          await apiUpdateCanvas(canvasId, { title: suggestedName });
        }
      } catch (err) {
        console.error("Auto-naming failed:", err);
        // Not critical — canvas keeps 'Untitled Canvas' name
      } finally {
        setIsNaming(false);
      }
    }

    navigate("/dashboard", { state: { closedCanvasId: canvasId } });
  }, [canvasId, title, navigate]);

  // History guard — intercept Android/browser back button
  const handleCanvasExitRef = useRef(handleCanvasExit);
  useEffect(() => { handleCanvasExitRef.current = handleCanvasExit; }, [handleCanvasExit]);

  useEffect(() => {
    window.history.pushState({ canvasGuard: true }, "", window.location.href);

    const onPopState = () => {
      // Re-push guard to block rapid double-back during async exit
      window.history.pushState({ canvasGuard: true }, "", window.location.href);
      handleCanvasExitRef.current();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);


  // ── Node selection handlers ──
  const activeNodeIdRef = useRef<string | null>(null);
  useEffect(() => { activeNodeIdRef.current = activeNode?.id ?? null; }, [activeNode]);

  const handleNodeTap = useCallback((nodeInfo: { id: string; label: string; rect: DOMRect }) => {
    // Toggle: clicking the same node again deselects it
    if (activeNodeIdRef.current === nodeInfo.id) {
      setActiveNode(null);
      return;
    }

    const codeDefinition = findNodeDefinition(mermaidCodeRef.current, nodeInfo.id);
    setActiveNode({
      id: nodeInfo.id,
      label: nodeInfo.label,
      codeDefinition,
      rect: nodeInfo.rect,
    });
  }, []);

  const handleAddNodeSelection = useCallback(() => {
    if (!activeNode) return;

    // Check if already selected
    if (selectedNodes.some((n) => n.id === activeNode.id)) {
      // Flash the existing pill
      setFlashPillId(activeNode.id);
      setTimeout(() => setFlashPillId(null), 500);
      setActiveNode(null);
      return;
    }

    setSelectedNodes((prev) => [
      ...prev,
      { id: activeNode.id, label: activeNode.label, codeDefinition: activeNode.codeDefinition },
    ]);
    setActiveNode(null);
  }, [activeNode, selectedNodes]);

  const handleRemoveNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }, []);

  const handleClearAllSelections = useCallback(() => {
    setSelectedNodes([]);
    setActiveNode(null);
  }, []);

  // Build the action list for the overlay (extensible — add new entries here)
  const nodeActions: NodeAction[] = activeNode
    ? [
        {
          id: "add-selection",
          icon: "add",
          label: "Add to selection",
          onClick: handleAddNodeSelection,
        },
        // Future actions go here:
        // { id: 'edit-label', icon: 'edit', label: 'Edit label', onClick: handleEditLabel },
      ]
    : [];

  // ── Unified send message (ref-backed, closure-proof) ──
  const selectedNodesRef = useRef<SelectedNode[]>([]);
  useEffect(() => { selectedNodesRef.current = selectedNodes; }, [selectedNodes]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || chatLoadingRef.current) return;
    flushPreviewMode();

    // Augment message with selected node context
    let augmentedMessage = text.trim();
    const nodes = selectedNodesRef.current;
    if (nodes.length > 0) {
      const nodeLines = nodes
        .map((n) => `- Node "${n.id}", Definition: ${n.codeDefinition}`)
        .join("\n");
      augmentedMessage = `[The user has selected the following node(s) to target with their instruction:\n${nodeLines}\n]\n\n${augmentedMessage}`;
      // Clear selections after consuming
      setSelectedNodes([]);
      setActiveNode(null);
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: augmentedMessage,
      timestamp: new Date().toISOString(),
    };

    const newHistory = [...chatHistoryRef.current, userMessage];
    setChatHistory(newHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const result = await apiChat(augmentedMessage, mermaidCodeRef.current, newHistory, canvasId || undefined);

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.response,
        timestamp: new Date().toISOString(),
      };

      const updatedHistory = [...newHistory, assistantMessage];
      setChatHistory(updatedHistory);

      // Apply directly — version history is the safety net
      if (result.updatedMermaidCode) {
        setMermaidCode(result.updatedMermaidCode);
        playCanvasSound();
        createCommit(result.updatedMermaidCode, "ai_chat", text.trim());
      }

      autoSave(result.updatedMermaidCode || mermaidCodeRef.current, updatedHistory);
    } catch (err) {
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`,
        timestamp: new Date().toISOString(),
      };
      setChatHistory([...newHistory, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  }, [autoSave, playCanvasSound, createCommit, flushPreviewMode]);


  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    flushPreviewMode();
    setChatLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        const result = await apiUploadFile(base64, file.name, file.type);

        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: result.response,
          timestamp: new Date().toISOString(),
        };

        const updatedHistory = [...chatHistory, assistantMessage];
        setChatHistory(updatedHistory);

        // Apply directly — version history is the safety net
        if (result.mermaidCode) {
          setMermaidCode(result.mermaidCode);
          playCanvasSound();
          autoSave(result.mermaidCode, updatedHistory);
          createCommit(result.mermaidCode, "upload", file.name);
        }
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setChatLoading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Pan/Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const maxZoom = getCanvasSettings().maxZoomLevel;
    setZoom((z) => Math.min(maxZoom, Math.max(0.2, z + delta)));
  };

  // Unified pointer tracking for pan (1 finger) + pinch-zoom (2 fingers)
  const getPointerDist = (): number | null => {
    const pts = Array.from(activePointers.current.values());
    if (pts.length < 2) return null;
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.hypot(dx, dy);
  };

  const lastPinchDist = useRef<number | null>(null);

  // Track the original pointerdown target for node tap detection
  // (needed because setPointerCapture redirects pointerup to the canvas element)
  const nodeTapRef = useRef<{
    nodeEl: Element;
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
  } | null>(null);

  const backgroundTapRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    pointerId: number;
    hadNode: boolean;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    console.log('[NodeTap] 🔵 pointerDown fired — target:', (e.target as HTMLElement).tagName, (e.target as HTMLElement).className);

    if (!(e.target === canvasRef.current || (e.target as HTMLElement).closest(".canvas-area"))) {
      console.log('[NodeTap] ❌ SUSPECT 1: Guard returned early — .closest(".canvas-area") failed. Target is NOT inside canvas-area.');
      return;
    }
    console.log('[NodeTap] ✅ Passed canvas-area guard');

    // Don't hijack clicks on interactive elements (mic button, zoom buttons, file inputs, etc.)
    const target = e.target as HTMLElement;
    const interactiveMatch = target.closest("button, a, input, label, textarea, select, [role='button']");
    if (interactiveMatch) {
      console.log('[NodeTap] ❌ SUSPECT 2: Guard returned early — matched interactive element:', interactiveMatch.tagName, interactiveMatch.className);
      return;
    }
    console.log('[NodeTap] ✅ Passed interactive-element guard');

    // Hit-test: find which .node SVG element contains the click point.
    // We use bounding-rect intersection instead of .closest(".node") because
    // Mermaid renders labels as HTML inside <foreignObject>, and .closest()
    // can't traverse from HTML elements across the SVG namespace boundary.
    let nodeEl: Element | null = null;
    const allNodes = canvasRef.current?.querySelectorAll(".node");
    if (allNodes) {
      for (const node of allNodes) {
        const r = node.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top && e.clientY <= r.bottom) {
          nodeEl = node;
          break;
        }
      }
    }

    if (nodeEl) {
      console.log('[NodeTap] ✅ Hit-test found node:', nodeEl.id, '— recording tap state');
      nodeTapRef.current = {
        nodeEl,
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
        pointerId: e.pointerId,
      };
    } else {
      console.log('[NodeTap] ⚪ Hit-test found no node at', e.clientX, e.clientY, '— allNodes count:', allNodes?.length ?? 0);
      nodeTapRef.current = null;
    }

    // Always track for background tap detection (deselect active node)
    backgroundTapRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      pointerId: e.pointerId,
      hadNode: !!nodeEl,
    };
    console.log('[NodeTap] 🔵 pointerDown complete — nodeTap:', !!nodeTapRef.current, ', bgTap hadNode:', !!nodeEl);

    // Prevent text selection while dragging
    e.preventDefault();

    // Capture on the stable canvas div (not e.target which may be an SVG child
    // that React re-creates on re-render, silently dropping the capture)
    canvasRef.current?.setPointerCapture(e.pointerId);

    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      // Single pointer — start panning
      isPanningRef.current = true;
      setIsPanningVisual(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    } else if (activePointers.current.size === 2) {
      // Second pointer — switch to pinch, cancel pan
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

    // Cancel pending node tap if pointer moved too far
    const tapState = nodeTapRef.current;
    if (tapState && tapState.pointerId === e.pointerId) {
      const dx = e.clientX - tapState.startX;
      const dy = e.clientY - tapState.startY;
      if (Math.hypot(dx, dy) > 10) {
        nodeTapRef.current = null; // Too much movement — it's a pan, not a tap
      }
    }

    // Cancel background tap if moved too far
    const bgTap = backgroundTapRef.current;
    if (bgTap && bgTap.pointerId === e.pointerId) {
      const dx = e.clientX - bgTap.startX;
      const dy = e.clientY - bgTap.startY;
      if (Math.hypot(dx, dy) > 10) {
        backgroundTapRef.current = null;
      }
    }

    if (activePointers.current.size === 2) {
      // Pinch zoom
      const dist = getPointerDist();
      if (dist !== null && lastPinchDist.current !== null) {
        const delta = (dist - lastPinchDist.current) * 0.005;
        const maxZoom = getCanvasSettings().maxZoomLevel;
        setZoom((z) => Math.min(maxZoom, Math.max(0.2, z + delta)));
        lastPinchDist.current = dist;
      }
    } else if (activePointers.current.size === 1 && isPanningRef.current) {
      // Single-pointer pan (reads ref — always synchronous, no stale closure)
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    console.log('[NodeTap] 🟢 pointerUp fired');
    // Release capture on the stable canvas div
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      lastPinchDist.current = null;
    }
    if (activePointers.current.size === 0) {
      isPanningRef.current = false;
      setIsPanningVisual(false);
    }

    // ── Node tap detection ──
    // Check if this was a stationary tap on a .node element
    const tapState = nodeTapRef.current;
    console.log('[NodeTap] 🟢 tapState:', tapState ? `node ${tapState.nodeEl.id}` : 'null');

    if (tapState && tapState.pointerId === e.pointerId) {
      nodeTapRef.current = null;
      const elapsed = Date.now() - tapState.startTime;
      console.log('[NodeTap] 🟢 Tap elapsed:', elapsed, 'ms (limit: 300ms)');

      if (elapsed < 300) {
        // Confirmed tap on a node! Extract info and fire handler.
        const nodeEl = tapState.nodeEl;
        const svgId = nodeEl.id || "";
        const nodeId = extractNodeId(svgId);
        console.log('[NodeTap] 🟢 svgId:', svgId, '→ nodeId:', nodeId);

        if (nodeId) {
          const labelEl = nodeEl.querySelector(".nodeLabel");
          const label = labelEl?.textContent?.trim() || nodeId;
          const rect = nodeEl.getBoundingClientRect();
          console.log('[NodeTap] ✅✅✅ CONFIRMED TAP — calling handleNodeTap:', { id: nodeId, label, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } });
          handleNodeTap({ id: nodeId, label, rect });
          return; // Don't also deselect
        } else {
          console.log('[NodeTap] ❌ extractNodeId returned null for svgId:', svgId);
        }
      } else {
        console.log('[NodeTap] ⚪ Tap too slow — treating as hold/drag');
      }
    }

    // ── Background tap detection ──
    const bgTapState = backgroundTapRef.current;
    if (bgTapState && bgTapState.pointerId === e.pointerId && !bgTapState.hadNode) {
      backgroundTapRef.current = null;
      const bgElapsed = Date.now() - bgTapState.startTime;
      if (bgElapsed < 300) {
        console.log('[NodeTap] 🟢 Background tap — clearing activeNode');
        setActiveNode(null);
      }
    } else {
      backgroundTapRef.current = null;
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
    setZoom((z) => Math.min(maxZoom, z + 0.2));
  };
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, z - 0.2));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };



  return (
    <div className="bg-background font-body text-on-surface overflow-hidden h-dvh flex flex-col">
      {/* Naming overlay */}
      {isNaming && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
            <span
              className="material-symbols-outlined text-3xl text-primary animate-pulse"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <span className="text-sm font-semibold text-on-surface">Naming your canvas…</span>
            <div className="spinner w-5 h-5" />
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-outline-variant/30 sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCanvasExit}
              disabled={isNaming}
              className="material-symbols-outlined text-on-surface p-2 -ml-2 rounded-full active:bg-surface-container-high transition-colors disabled:opacity-40"
            >
              arrow_back
            </button>
            {editingTitle ? (
              <input
                className="font-manrope font-extrabold text-lg tracking-tight text-primary bg-surface-container-high rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-secondary"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                autoFocus
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                className="font-manrope font-extrabold text-lg tracking-tight text-primary cursor-pointer hover:text-secondary transition-colors"
              >
                {title}
              </h1>
            )}
          </div>
          <div className="flex items-center gap-3 relative">
            {saving && <span className="text-xs text-on-surface-variant animate-pulse">Saving...</span>}

            {/* Publish toggle */}
            <button
              onClick={handlePublishToggle}
              disabled={publishing || !canvasId}
              className={`hidden sm:inline-flex items-center justify-center rounded-full text-xs font-bold transition-all duration-200 active:scale-95 disabled:opacity-40 bg-surface-container-high text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low hover:text-on-surface ${isPublic ? "w-8 h-8 outline outline-2 outline-emerald-800 outline-offset-[3px]" : "gap-1.5 px-3.5 py-2"
                }`}
              title={isPublic ? "Published" : "Publish"}
            >
              <span
                className={`material-symbols-outlined text-base transition-all duration-300 ${isPublic ? "text-emerald-700" : ""}`}
                style={{ fontVariationSettings: isPublic ? "'FILL' 1" : "'FILL' 0" }}
              >
                {isPublic ? "public" : "public_off"}
              </span>
              {!isPublic && (publishing ? "..." : "Publish")}
            </button>

            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShareExiting(false);
                  setShareCopied(true);

                  if (isPublic && canvasId) {
                    const publicUrl = `${window.location.origin}/view/${canvasId}`;
                    navigator.clipboard.writeText(publicUrl);
                  }

                  setTimeout(() => {
                    setShareExiting(true);
                    setTimeout(() => {
                      setShareCopied(false);
                      setShareExiting(false);
                    }, 250);
                  }, 1400);
                }}
                className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold bg-surface-container-high text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low hover:text-on-surface transition-all duration-200 active:scale-95"
              >
                <span className="material-symbols-outlined text-base">share</span>
                Share
              </button>

              {/* Toast pill */}
              {shareCopied && (
                <div
                  className={`absolute top-full mt-2 right-0 whitespace-nowrap px-3 py-1.5 rounded-full text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-xl z-50 ${isPublic ? "bg-slate-900" : "bg-amber-600"
                    } ${shareExiting ? "toast-copied-exit" : "toast-copied"}`}
                >
                  {isPublic ? (
                    <>
                      <span className="material-symbols-outlined text-sm text-emerald-400" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      Link copied!
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm text-amber-200" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                      Publish first to share
                    </>
                  )}
                </div>
              )}
            </div>

            <ProfileMenu />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex-1 flex overflow-hidden min-h-0">
        {/* Canvas / Code area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Floating view toggle toolbar */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 md:z-40 pointer-events-auto transition-all duration-300">
            <div className="inline-flex items-center bg-white/80 backdrop-blur-xl rounded-full border border-outline-variant/20 px-1 py-1 gap-0.5 shadow-lg shadow-black/5">
              <button
                onClick={() => handleViewSwitch("flowchart")}
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${activeView === "flowchart"
                    ? "bg-white text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container-high/60"
                  }`}
              >
                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'opsz' 20" }}>account_tree</span>
                Flowchart
              </button>

              <div className="w-px h-5 bg-outline-variant/20" />

              <button
                onClick={() => handleViewSwitch("code")}
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${activeView === "code"
                    ? "bg-white text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container-high/60"
                  }`}
              >
                <span className="material-symbols-outlined text-base">code</span>
                Code
              </button>

              <div className="w-px h-5 bg-outline-variant/20" />

              <button
                onClick={() => {
                  navigator.clipboard.writeText(mermaidCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high/60 transition-all duration-200"
                title="Copy Mermaid code"
              >
                <span className="material-symbols-outlined text-base">{copied ? "check" : "content_copy"}</span>
              </button>
            </div>
          </div>
          {activeView === "flowchart" ? (
            <>
            {/* Infinite canvas */}
            <div
              ref={canvasRef}
              className="flex-1 canvas-grid bg-surface relative overflow-hidden no-scrollbar touch-none canvas-area select-none"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              style={{ cursor: isPanningVisual ? "grabbing" : "grab" }}
            >
              {/* Zoom controls */}
              <div className={`absolute left-4 flex flex-col gap-2 z-40 transition-all duration-300 ${showChat ? "md:opacity-100 md:pointer-events-auto opacity-0 pointer-events-none" : "opacity-100"}`} style={{ bottom: `${inputBarHeight + 16}px` }}>
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
                {/* Skills Button */}
                <button
                  onClick={() => setShowSkillsPanel(prev => !prev)}
                  className={`p-3 bg-white shadow-xl border border-outline-variant/30 rounded-full hover:bg-surface-container text-on-surface-variant material-symbols-outlined text-xl transition-all ${showSkillsPanel ? "ring-2 ring-primary text-primary" : ""}`}
                  title="Canvas Skills"
                >
                  auto_awesome
                </button>
              </div>

              {/* Mobile floating action buttons (mic + paperclip) moved to main level to avoid canvas z-index context */}


              {/* Rendered diagram */}
              <div
                className="min-h-full w-full flex items-center justify-center"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: isPanningVisual ? "none" : "transform 0.1s ease-out",
                }}
              >
                <MermaidRenderer
                  code={mermaidCode}
                  className="min-h-[400px] min-w-[300px]"
                  onSyntaxError={handleSyntaxError}
                  isFixing={isFixing}
                  activeNodeId={activeNode?.id ?? null}
                  selectedNodeIds={selectedNodes.map((n) => n.id)}
                />
              </div>

              {/* Skills Panel */}
              {canvasId && (
                <CanvasSkillsPanel
                  canvasId={canvasId}
                  isOpen={showSkillsPanel}
                  onClose={() => setShowSkillsPanel(false)}
                  onSkillTriggered={(result) => {
                    flushPreviewMode();
                    if (result.updatedMermaidCode) {
                      setMermaidCode(result.updatedMermaidCode);
                      playCanvasSound();
                      autoSave(result.updatedMermaidCode);
                      createCommit(result.updatedMermaidCode, "ai_chat", `Skill: ${result.skillTitle}`);
                    }
                    const skillMsg: ChatMessage = {
                      role: "assistant",
                      content: result.response || `⚡ Applied skill "${result.skillTitle}"`,
                      timestamp: new Date().toISOString(),
                    };
                    setChatHistory(prev => [...prev, skillMsg]);
                  }}
                />
              )}
            </div>

            {/* Node Action Overlay — rendered OUTSIDE the canvas div to escape overflow:hidden */}
            {activeView === "flowchart" && (
              <NodeActionOverlay
                nodeRect={activeNode?.rect ?? null}
                visible={!!activeNode}
                actions={nodeActions}
              />
            )}
            </>
          ) : (
            /* Code editor view */
            <div className="flex-1 flex flex-col bg-surface-container-lowest p-4">
              <textarea
                className="flex-1 w-full bg-surface-container-high rounded-xl p-6 font-mono text-sm text-on-surface outline-none focus:ring-2 focus:ring-secondary/20 resize-none"
                value={"\n\n\n\n" + mermaidCode + "\n\n\n\n\n\n\n"}
                onChange={(e) => {
                  let raw = e.target.value;
                  // Strip the 4 leading newlines we inject for visual padding
                  raw = raw.startsWith("\n\n\n\n") ? raw.slice(4) : raw.trimStart();
                  // Strip the 7 trailing newlines we inject for visual padding
                  raw = raw.endsWith("\n\n\n\n\n\n\n") ? raw.slice(0, -7) : raw.trimEnd();
                  handleMermaidCodeChange(raw);
                }}
                spellCheck={false}
                placeholder="Enter Mermaid code here..."
              />
            </div>
          )}

          {/* ── Floating chat input bar ─────────────────────── */}
          <div ref={inputBarRef} className="absolute bottom-3 md:bottom-5 left-3 right-3 md:left-1/2 md:-translate-x-1/2 md:w-[calc(100%-40px)] md:max-w-[700px] z-30">
            <div className="bg-white/70 backdrop-blur-2xl border border-[#c4c4c4] rounded-[22px] shadow-[0_4px_32px_rgba(0,0,0,0.08)] overflow-hidden">

              {/* Node selection pills — scrollable tray */}
              {selectedNodes.length > 0 && (
                <div className="node-selection-tray-wrapper">
                  {/* Left scroll arrow */}
                  <button
                    className="node-scroll-arrow node-scroll-arrow-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      const tray = (e.currentTarget as HTMLElement).parentElement?.querySelector('.node-selection-tray');
                      tray?.scrollBy({ left: -120, behavior: 'smooth' });
                    }}
                    title="Scroll left"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_left</span>
                  </button>

                  <div className="node-selection-tray">
                    {selectedNodes.map((node) => (
                      <div
                        key={node.id}
                        className={`node-selection-pill ${flashPillId === node.id ? "node-selection-pill-flash" : ""}`}
                      >
                        <span className="node-selection-pill-label" title={node.codeDefinition}>
                          {node.label.length > 30 ? `${node.label.slice(0, 27)}...` : node.label}
                        </span>
                        <button
                          className="node-selection-pill-dismiss"
                          onClick={() => handleRemoveNodeSelection(node.id)}
                          title="Remove"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                        </button>
                      </div>
                    ))}
                    {selectedNodes.length >= 2 && (
                      <button className="node-selection-clear-all" onClick={handleClearAllSelections}>
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Right scroll arrow */}
                  <button
                    className="node-scroll-arrow node-scroll-arrow-right"
                    onClick={(e) => {
                      e.stopPropagation();
                      const tray = (e.currentTarget as HTMLElement).parentElement?.querySelector('.node-selection-tray');
                      tray?.scrollBy({ left: 120, behavior: 'smooth' });
                    }}
                    title="Scroll right"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
                  </button>
                </div>
              )}

              {/* Input row */}
              <div className="p-2.5 md:p-3 flex items-end gap-2.5">

                {/* Chat History Toggle (Mobile only) */}
                <button
                  onClick={() => setShowChat(!showChat)}
                  className={`md:hidden shrink-0 h-11 w-11 rounded-xl flex items-center justify-center transition-all ${showChat ? "bg-primary text-white" : "text-on-surface-variant hover:text-primary active:scale-95"
                    }`}
                >
                  <span className="material-symbols-outlined text-xl">
                    {showChat ? "keyboard_arrow_down" : "history"}
                  </span>
                </button>

                {/* Paperclip — desktop inline (left side) */}
                <label className="hidden md:flex cursor-pointer shrink-0 w-10 h-10 rounded-full items-center justify-center text-on-surface-variant/60 hover:text-primary hover:bg-surface-container-high/40 transition-all self-end">
                  <span className="material-symbols-outlined text-xl">attach_file</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.txt,.md,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                </label>

                {/* Auto-growing textarea */}
                <div className="flex-1 min-w-0">
                  <textarea
                    ref={textareaRef}
                    className="w-full bg-transparent border-none rounded-xl px-3 py-2.5 text-sm font-medium placeholder:text-on-surface-variant/40 focus:ring-0 transition-all outline-none resize-none no-scrollbar"
                    placeholder="Describe your flowchart..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(chatInput);
                      }
                    }}
                    rows={1}
                  />
                </div>

                {/* Action buttons */}
                <div className="shrink-0 flex items-end gap-1.5">

                  {/* Desktop-only: mic inline */}
                  <div className="hidden md:block">
                    <VoiceMicButton
                      onTranscript={(text) => setChatInput((prev) => prev ? `${prev} ${text}` : text)}
                      onAutoSendTranscript={sendMessage}
                      disabled={chatLoading}
                    />
                  </div>

                  {/* Send button */}
                  <button
                    onClick={() => sendMessage(chatInput)}
                    disabled={chatLoading || !chatInput.trim()}
                    className="h-10 w-10 bg-primary text-white rounded-xl flex items-center justify-center active:scale-90 transition-all shadow-lg shadow-primary/20 disabled:opacity-30"
                  >
                    {chatLoading ? (
                      <span className="spinner border-white/30 border-t-white" style={{ width: 16, height: 16 }} />
                    ) : (
                      <span
                        className="material-symbols-outlined text-lg"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        send
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Manager panel (desktop sidebar / mobile bottom sheet) */}
        <div
          className={`absolute md:relative left-0 md:left-auto right-0 bottom-[var(--chat-bottom)] md:bottom-auto top-0 md:top-0 h-auto md:h-full w-full md:w-[380px] bg-white/95 backdrop-blur-2xl md:bg-white/90 md:backdrop-blur-xl border-t md:border-t-0 md:border-l md:border-l-[#c4c4c4] border-outline-variant/15 z-20 md:z-auto transition-all duration-300 flex flex-col shadow-[0_-10px_40px_rgb(0,0,0,0.08)] md:shadow-none ${showChat ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[0.98] opacity-0 pointer-events-none md:translate-y-0 md:scale-100 md:opacity-100 md:pointer-events-auto"
            }`}
          style={{
            '--chat-bottom': `${inputBarHeight + 20}px`
          } as React.CSSProperties}
        >
          <AgentGitLog
            chatHistory={chatHistory}
            chatLoading={chatLoading}
            commits={commits}
            onRestore={handleRestoreVersion}
            isPublic={isPublic}
            canvasId={canvasId}
            publishing={publishing}
            onPublishToggle={handlePublishToggle}
            previewMode={previewMode}
            previewVersionNumber={previewVersionNumber}
          />



        </div>

        {/* Mobile floating action buttons (mic + paperclip) */}
        <div className="md:hidden absolute right-4 flex flex-col items-center gap-2 z-[10000] transition-all duration-300" style={{ bottom: `${inputBarHeight + 16}px` }}>
          <label className="cursor-pointer shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary transition-all bg-white shadow-xl border border-outline-variant/30 shadow-[0_8px_32px_rgba(0,0,0,0.15)]">
            <span className="material-symbols-outlined text-xl">attach_file</span>
            <input
              type="file"
              className="hidden"
              accept="image/*,.pdf,.txt,.md,.doc,.docx"
              onChange={handleFileUpload}
            />
          </label>
          <div className="voice-mic-mobile-float shadow-[0_8px_32px_rgba(0,0,0,0.15)] rounded-full">
            <VoiceMicButton
              onTranscript={(text) => setChatInput((prev) => prev ? `${prev} ${text}` : text)}
              onAutoSendTranscript={sendMessage}
              disabled={chatLoading}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
