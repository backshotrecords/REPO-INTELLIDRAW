import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MermaidRenderer from "../components/MermaidRenderer";
import ProfileMenu from "../components/ProfileMenu";
import VoiceMicButton from "../components/VoiceMicButton";
import AgentGitLog from "../components/AgentGitLog";
import { apiGetCanvas, apiCreateCanvas, apiUpdateCanvas, apiChat, apiUploadFile, apiGetActiveRules, apiPublishCanvas } from "../lib/api";
import type { ChatMessage } from "../types";

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [canvasId, setCanvasId] = useState<string | null>(id === "new" ? null : id || null);
  const [title, setTitle] = useState("Untitled Canvas");
  const [mermaidCode, setMermaidCode] = useState("flowchart TD\n    A[Start] --> B[Next Step]");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [activeView, setActiveView] = useState<"flowchart" | "code">("flowchart");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
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
  const [inputBarHeight, setInputBarHeight] = useState(60);

  // Canvas pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const codeOnEnterRef = useRef("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPinchDist = useRef<number | null>(null);

  // Load canvas
  const loadCanvas = useCallback(async (canvasId: string) => {
    try {
      const canvas = await apiGetCanvas(canvasId);
      setCanvasId(canvas.id);
      setTitle(canvas.title);
      setMermaidCode(canvas.mermaid_code);
      setChatHistory(canvas.chat_history || []);
      setIsPublic(canvas.is_public || false);
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

  const handleSyntaxError = useCallback(async (_errorMsg: string, brokenCode: string) => {
    if (isFixing || chatLoading) return;
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
        ...(result.updatedMermaidCode && {
          mermaidSnapshot: result.updatedMermaidCode,
          versionSource: "auto_fix" as const,
        }),
      };
      setChatHistory((prev) => [...prev, assistantMessage]);

      if (result.updatedMermaidCode) {
        // Apply directly to canvas — no pending button
        setMermaidCode(result.updatedMermaidCode);
        autoSave(result.updatedMermaidCode);
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
  }, [isFixing, chatLoading, chatHistory, autoSave]);

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

  // Restore a version from the git log
  const handleRestoreVersion = (snapshot: string) => {
    setMermaidCode(snapshot);
    const restoreMsg: ChatMessage = {
      role: "assistant",
      content: "↩️ Restored to a previous version",
      timestamp: new Date().toISOString(),
      mermaidSnapshot: snapshot,
      versionSource: "restore",
    };
    const newHistory = [...chatHistory, restoreMsg];
    setChatHistory(newHistory);
    autoSave(snapshot, newHistory);
  };

  // Manual edit tracking on view switch
  const handleViewSwitch = (view: "flowchart" | "code") => {
    if (view === "code" && activeView !== "code") {
      codeOnEnterRef.current = mermaidCode;
    } else if (view === "flowchart" && activeView === "code") {
      if (mermaidCode !== codeOnEnterRef.current) {
        const lastMsg = chatHistory[chatHistory.length - 1];
        const isRecentManual = lastMsg?.versionSource === "manual" &&
          (Date.now() - new Date(lastMsg.timestamp).getTime()) < 30000;
        if (isRecentManual) {
          const updated = [...chatHistory];
          updated[updated.length - 1] = {
            ...lastMsg,
            mermaidSnapshot: mermaidCode,
            timestamp: new Date().toISOString(),
          };
          setChatHistory(updated);
          autoSave(mermaidCode, updated);
        } else {
          const manualMsg: ChatMessage = {
            role: "assistant",
            content: "✏️ Canvas updated via code editor",
            timestamp: new Date().toISOString(),
            mermaidSnapshot: mermaidCode,
            versionSource: "manual",
          };
          const newHistory = [...chatHistory, manualMsg];
          setChatHistory(newHistory);
          autoSave(mermaidCode, newHistory);
        }
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

  // Chat
  const handleSendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date().toISOString(),
    };

    const newHistory = [...chatHistory, userMessage];
    setChatHistory(newHistory);
    setChatInput("");
    setChatLoading(true);

    try {
      const result = await apiChat(chatInput.trim(), mermaidCode, newHistory);

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.response,
        timestamp: new Date().toISOString(),
        ...(result.updatedMermaidCode && {
          mermaidSnapshot: result.updatedMermaidCode,
          versionSource: "ai_chat" as const,
        }),
      };

      const updatedHistory = [...newHistory, assistantMessage];
      setChatHistory(updatedHistory);

      // Apply directly — version history is the safety net
      if (result.updatedMermaidCode) {
        setMermaidCode(result.updatedMermaidCode);
      }

      autoSave(result.updatedMermaidCode || mermaidCode, updatedHistory);
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
  };


  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
          ...(result.mermaidCode && {
            mermaidSnapshot: result.mermaidCode,
            versionSource: "upload" as const,
          }),
        };

        const updatedHistory = [...chatHistory, assistantMessage];
        setChatHistory(updatedHistory);

        // Apply directly — version history is the safety net
        if (result.mermaidCode) {
          setMermaidCode(result.mermaidCode);
          autoSave(result.mermaidCode, updatedHistory);
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

  // Pinch-to-zoom touch gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = (dist - lastPinchDist.current) * 0.005;
      setZoom((z) => Math.min(16, Math.max(0.2, z + delta)));
      lastPinchDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    lastPinchDist.current = null;
  };

  const handleZoomIn = () => setZoom((z) => Math.min(16, z + 0.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, z - 0.2));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };



  return (
    <div className="bg-background font-body text-on-surface overflow-hidden h-dvh flex flex-col">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-outline-variant/30 sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/dashboard")}
              className="material-symbols-outlined text-on-surface p-2 -ml-2 rounded-full active:bg-surface-container-high transition-colors"
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
              className={`hidden sm:inline-flex items-center justify-center rounded-full text-xs font-bold transition-all duration-200 active:scale-95 disabled:opacity-40 bg-surface-container-high text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low hover:text-on-surface ${
                isPublic ? "w-8 h-8 outline outline-2 outline-emerald-800 outline-offset-[3px]" : "gap-1.5 px-3.5 py-2"
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
                  className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1.5 rounded-full text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-xl z-50 ${
                    isPublic ? "bg-slate-900" : "bg-amber-600"
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
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
            <div className="inline-flex items-center bg-white/80 backdrop-blur-xl rounded-full border border-outline-variant/20 px-1 py-1 gap-0.5 shadow-lg shadow-black/5">
              <button
                onClick={() => handleViewSwitch("flowchart")}
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
                  activeView === "flowchart"
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
                className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
                  activeView === "code"
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
            /* Infinite canvas */
            <div
              ref={canvasRef}
              className="flex-1 canvas-grid bg-surface relative overflow-hidden no-scrollbar touch-none canvas-area"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ cursor: isPanning ? "grabbing" : "grab" }}
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
              </div>

              {/* Mobile floating action buttons (mic + paperclip) — right side, same layer as zoom */}
              <div className={`md:hidden absolute right-4 flex flex-col items-center gap-2 z-40 transition-all duration-300 ${showChat ? "opacity-0 pointer-events-none" : "opacity-100"}`} style={{ bottom: `${inputBarHeight + 16}px` }}>
                <label className="cursor-pointer shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary transition-all bg-white shadow-xl border border-outline-variant/30">
                  <span className="material-symbols-outlined text-xl">attach_file</span>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.txt,.md,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                </label>
                <div className="voice-mic-mobile-float">
                  <VoiceMicButton
                    onTranscript={(text) => setChatInput((prev) => prev ? `${prev} ${text}` : text)}
                    disabled={chatLoading}
                  />
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
                  onSyntaxError={handleSyntaxError}
                  isFixing={isFixing}
                />
              </div>
            </div>
          ) : (
            /* Code editor view */
            <div className="flex-1 flex flex-col bg-surface-container-lowest p-4">
              <textarea
                className="flex-1 w-full bg-surface-container-high rounded-xl p-6 font-mono text-sm text-on-surface outline-none focus:ring-2 focus:ring-secondary/20 resize-none"
                value={"\n\n\n\n" + mermaidCode}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Strip the 4 leading newlines we inject for visual padding
                  const stripped = raw.startsWith("\n\n\n\n") ? raw.slice(4) : raw.trimStart();
                  handleMermaidCodeChange(stripped);
                }}
                spellCheck={false}
                placeholder="Enter Mermaid code here..."
              />
            </div>
          )}

          {/* ── Floating chat input bar ─────────────────────── */}
          <div ref={inputBarRef} className="absolute bottom-3 md:bottom-5 left-3 right-3 md:left-1/2 md:-translate-x-1/2 md:w-[calc(100%-40px)] md:max-w-[700px] z-30">
            <div className="bg-white/70 backdrop-blur-2xl border border-outline-variant/15 rounded-[22px] shadow-[0_4px_32px_rgba(0,0,0,0.08)] overflow-hidden">

              {/* Input row */}
              <div className="p-2.5 md:p-3 flex items-end gap-2.5">

                {/* Chat History Toggle (Mobile only) */}
                <button
                  onClick={() => setShowChat(!showChat)}
                  className={`md:hidden shrink-0 h-11 w-11 rounded-xl flex items-center justify-center transition-all ${
                    showChat ? "bg-primary text-white" : "text-on-surface-variant hover:text-primary active:scale-95"
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
                        handleSendMessage();
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
                      disabled={chatLoading}
                    />
                  </div>

                  {/* Send button */}
                  <button
                    onClick={handleSendMessage}
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
          className={`fixed md:relative left-0 md:left-auto right-0 bottom-[104px] md:bottom-auto top-auto md:top-0 h-[50vh] md:h-full w-full md:w-[380px] bg-white/80 backdrop-blur-2xl md:bg-white/90 md:backdrop-blur-xl border-t md:border-t-0 md:border-l border-outline-variant/15 z-20 md:z-auto transition-all duration-300 flex flex-col shadow-[0_-10px_40px_rgb(0,0,0,0.08)] md:shadow-none ${
            showChat ? "translate-y-0 opacity-100" : "translate-y-[20%] opacity-0 pointer-events-none md:translate-y-0 md:opacity-100 md:pointer-events-auto"
          }`}
        >
          <AgentGitLog
            chatHistory={chatHistory}
            chatLoading={chatLoading}
            onRestore={handleRestoreVersion}
            isPublic={isPublic}
            canvasId={canvasId}
            publishing={publishing}
            onPublishToggle={handlePublishToggle}
          />




        </div>
      </main>
    </div>
  );
}
