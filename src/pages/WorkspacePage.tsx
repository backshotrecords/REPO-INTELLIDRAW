import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MermaidRenderer from "../components/MermaidRenderer";
import { apiGetCanvas, apiCreateCanvas, apiUpdateCanvas, apiChat, apiUploadFile } from "../lib/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

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
  const [pendingMermaid, setPendingMermaid] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  // Canvas pan/zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load canvas
  const loadCanvas = useCallback(async (canvasId: string) => {
    try {
      const canvas = await apiGetCanvas(canvasId);
      setCanvasId(canvas.id);
      setTitle(canvas.title);
      setMermaidCode(canvas.mermaid_code);
      setChatHistory(canvas.chat_history || []);
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

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, showChat]);

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
      };

      const updatedHistory = [...newHistory, assistantMessage];
      setChatHistory(updatedHistory);

      if (result.updatedMermaidCode) {
        setPendingMermaid(result.updatedMermaidCode);
      }

      autoSave(mermaidCode, updatedHistory);
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

  const handleApplyMermaid = () => {
    if (pendingMermaid) {
      setMermaidCode(pendingMermaid);
      autoSave(pendingMermaid, chatHistory);
      setPendingMermaid(null);
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
        };

        const updatedHistory = [...chatHistory, assistantMessage];
        setChatHistory(updatedHistory);

        if (result.mermaidCode) {
          setPendingMermaid(result.mermaidCode);
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
    setZoom((z) => Math.min(3, Math.max(0.2, z + delta)));
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

  const handleZoomIn = () => setZoom((z) => Math.min(3, z + 0.2));
  const handleZoomOut = () => setZoom((z) => Math.max(0.2, z - 0.2));
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Strip mermaid fences from AI response for display
  const cleanMessageContent = (content: string) => {
    return content.replace(/```mermaid\n[\s\S]*?```/g, "[Flowchart code generated — click 'Update Flowchart' to apply]");
  };

  return (
    <div className="bg-background font-body text-on-surface overflow-hidden h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-outline-variant/30 sticky top-0 z-50">
        <div className="flex flex-col w-full">
          <div className="flex justify-between items-center px-4 py-3">
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
            <div className="flex items-center gap-3">
              {saving && <span className="text-xs text-on-surface-variant animate-pulse">Saving...</span>}
              <button
                onClick={() => setShowChat(!showChat)}
                className="material-symbols-outlined text-on-surface-variant text-xl p-2 rounded-full hover:bg-surface-container-high transition-colors md:hidden"
              >
                {showChat ? "close" : "smart_toy"}
              </button>
            </div>
          </div>

          {/* View toggle tabs */}
          <div className="px-4 pb-3">
            <div className="bg-surface-container-low p-1 rounded-xl flex items-center w-full">
              <button
                onClick={() => setActiveView("flowchart")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  activeView === "flowchart"
                    ? "bg-white text-secondary shadow-sm"
                    : "text-on-surface-variant/70 hover:bg-surface-container-high"
                }`}
              >
                Flowchart
              </button>
              <button
                onClick={() => setActiveView("code")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  activeView === "code"
                    ? "bg-white text-secondary shadow-sm"
                    : "text-on-surface-variant/70 hover:bg-surface-container-high"
                }`}
              >
                Mermaid Code
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative flex-1 flex overflow-hidden min-h-0">
        {/* Canvas / Code area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeView === "flowchart" ? (
            /* Infinite canvas */
            <div
              ref={canvasRef}
              className="flex-1 canvas-grid bg-surface relative overflow-hidden no-scrollbar touch-pan-x touch-pan-y canvas-area"
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
                <MermaidRenderer code={mermaidCode} className="min-h-[400px] min-w-[300px]" />
              </div>
            </div>
          ) : (
            /* Code editor view */
            <div className="flex-1 overflow-auto bg-surface-container-lowest p-4">
              <textarea
                className="w-full h-full min-h-[500px] bg-surface-container-high rounded-xl p-6 font-mono text-sm text-on-surface outline-none focus:ring-2 focus:ring-secondary/20 resize-none"
                value={mermaidCode}
                onChange={(e) => handleMermaidCodeChange(e.target.value)}
                spellCheck={false}
                placeholder="Enter Mermaid code here..."
              />
            </div>
          )}

          {/* Pending mermaid update banner */}
          {pendingMermaid && (
            <div className="bg-primary/5 px-4 py-2 border-t border-outline-variant/20 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="material-symbols-outlined text-secondary text-lg">psychology</span>
                <p className="text-[11px] font-semibold text-on-surface-variant truncate">
                  AI generated a new flowchart — review and apply
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingMermaid(null)}
                  className="text-on-surface-variant text-[10px] font-bold uppercase px-2 py-1"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleApplyMermaid}
                  className="bg-secondary text-white text-[10px] font-bold uppercase px-3 py-1 rounded-lg"
                >
                  Update Flowchart
                </button>
              </div>
            </div>
          )}

          {/* Chat input bar (always visible at bottom) */}
          <div className="bg-white border-t border-outline-variant/40 shadow-[0_-8px_30px_rgb(0,0,0,0.06)] z-30">
            <div className="p-4 pb-8 md:pb-4 flex items-center gap-3">
              {/* File upload */}
              <label className="cursor-pointer p-2 text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-xl">attach_file</span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.txt,.md,.doc,.docx"
                  onChange={handleFileUpload}
                />
              </label>
              <div className="flex-1 relative">
                <input
                  className="w-full bg-surface-container-low border-none rounded-2xl px-5 py-4 text-sm font-medium placeholder:text-on-surface-variant/30 focus:ring-2 focus:ring-secondary/20 transition-all outline-none"
                  placeholder="Describe your flowchart..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="h-14 w-14 bg-primary text-white rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-xl shadow-primary/20 disabled:opacity-40"
              >
                {chatLoading ? (
                  <span className="spinner border-white/30 border-t-white" />
                ) : (
                  <span
                    className="material-symbols-outlined text-2xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    send
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Chat panel (desktop sidebar / mobile bottom sheet) */}
        <div
          className={`${
            showChat ? "translate-x-0" : "translate-x-full md:translate-x-0"
          } fixed md:relative right-0 top-0 h-full w-full md:w-[380px] bg-white border-l border-outline-variant/20 z-40 md:z-auto transition-transform duration-300 flex flex-col ${
            !showChat && "hidden md:flex"
          }`}
        >
          {/* Chat header */}
          <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-secondary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                smart_toy
              </span>
              <span className="font-bold text-sm text-on-surface">AI Assistant</span>
            </div>
            <button
              onClick={() => setShowChat(false)}
              className="md:hidden p-2 text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
            {chatHistory.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant/50">
                <span
                  className="material-symbols-outlined text-4xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  auto_awesome
                </span>
                <p className="text-sm text-center max-w-[220px]">
                  Start a conversation to generate or refine your flowchart
                </p>
              </div>
            )}

            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`chat-message-enter flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-white rounded-br-md"
                      : "bg-surface-container-low text-on-surface rounded-bl-md"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{cleanMessageContent(msg.content)}</p>
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-surface-container-low rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-on-surface-variant/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
