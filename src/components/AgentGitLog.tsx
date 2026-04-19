import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../types";
import ModelPicker from "./ModelPicker";

interface AgentGitLogProps {
  chatHistory: ChatMessage[];
  chatLoading: boolean;
  onRestore: (mermaidSnapshot: string) => void;
  isPublic: boolean;
  canvasId: string | null;
  publishing: boolean;
  onPublishToggle: () => void;
}

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function sourceIcon(source?: string): string {
  switch (source) {
    case "ai_chat": return "psychology";
    case "manual": return "edit";
    case "auto_fix": return "build";
    case "upload": return "attach_file";
    case "restore": return "restore";
    default: return "history";
  }
}

function cleanMessageContent(content: string): string {
  const cleaned = content.replace(/```mermaid\n[\s\S]*?```/g, "").trim();
  return cleaned || "Flowchart updated.";
}

interface Interaction {
  id: number;
  userMessage: ChatMessage | null;
  assistantMessages: ChatMessage[];
}

export default function AgentGitLog({
  chatHistory,
  chatLoading,
  onRestore,
  isPublic,
  canvasId,
  publishing,
  onPublishToggle,
}: AgentGitLogProps) {
  const [sidebarView, setSidebarView] = useState<"chat" | "tree">("chat");
  const [expandedPills, setExpandedPills] = useState<Record<number, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  // Share toast
  const [shareCopied, setShareCopied] = useState(false);
  const [shareExiting, setShareExiting] = useState(false);

  // Custom scrollbar
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startY = useRef(0);
  const startScrollTop = useRef(0);
  const [scrollState, setScrollState] = useState({ height: 0, top: 0, show: false });
  const [isDragging, setIsDragging] = useState(false);

  // Auto-scroll
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  // Group messages into interactions
  const interactions = useMemo<Interaction[]>(() => {
    const groups: Interaction[] = [];
    for (let i = 0; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      if (msg.role === "user") {
        groups.push({ id: groups.length, userMessage: msg, assistantMessages: [] });
      } else {
        // System events (manual edits, restores) are standalone
        const isSystemEvent = msg.versionSource === "manual" || msg.versionSource === "restore";
        if (!isSystemEvent && groups.length > 0 && groups[groups.length - 1].userMessage !== null) {
          groups[groups.length - 1].assistantMessages.push(msg);
        } else {
          groups.push({ id: groups.length, userMessage: null, assistantMessages: [msg] });
        }
      }
    }
    return groups;
  }, [chatHistory]);

  // Version list for tree view
  const versions = useMemo(() => {
    return chatHistory
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.mermaidSnapshot)
      .map((entry, vIdx) => ({ ...entry, versionNumber: vIdx + 1 }));
  }, [chatHistory]);

  // Get the LATEST mermaidSnapshot from an interaction
  const getInteractionSnapshot = (interaction: Interaction): string | undefined => {
    for (let i = interaction.assistantMessages.length - 1; i >= 0; i--) {
      if (interaction.assistantMessages[i].mermaidSnapshot) return interaction.assistantMessages[i].mermaidSnapshot;
    }
    return undefined;
  };

  // Pill expand/collapse
  const toggleExpand = (id: number) => {
    setExpandedPills(prev => {
      if (prev[id]) {
        const container = textContainerRefs.current[id];
        if (container) container.scrollTop = 0;
      }
      return { ...prev, [id]: !prev[id] };
    });
  };

  // Custom scrollbar logic
  const updateScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight) {
      setScrollState(prev => ({ ...prev, height: 0 }));
      return;
    }
    const trackHeight = clientHeight - 16;
    const height = Math.max((clientHeight / scrollHeight) * trackHeight, 30);
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - height;
    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
    setScrollState(prev => ({ ...prev, height, top }));
  }, []);

  const showScrollbarTemporarily = useCallback(() => {
    setScrollState(prev => ({ ...prev, show: true }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setScrollState(prev => ({ ...prev, show: false }));
    }, 2000);
  }, []);

  const handleScroll = () => { updateScroll(); showScrollbarTemporarily(); };
  const handleMouseMove = () => { if (!isDragging) showScrollbarTemporarily(); };

  useEffect(() => {
    requestAnimationFrame(updateScroll);
    window.addEventListener("resize", updateScroll);
    return () => window.removeEventListener("resize", updateScroll);
  }, [expandedPills, updateScroll, chatHistory]);

  // Scrollbar drag
  const onPointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    startY.current = e.clientY;
    if (scrollContainerRef.current) startScrollTop.current = scrollContainerRef.current.scrollTop;
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      const deltaY = e.clientY - startY.current;
      const trackHeight = container.clientHeight - 16;
      const height = Math.max((container.clientHeight / container.scrollHeight) * trackHeight, 30);
      const maxThumbTop = trackHeight - height;
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      const scrollDelta = deltaY * (maxScrollTop / maxThumbTop);
      container.scrollTop = startScrollTop.current + scrollDelta;
    };
    const onPointerUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.userSelect = "";
        showScrollbarTemporarily();
      }
    };
    if (isDragging) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDragging, showScrollbarTemporarily]);

  // Share handler
  const handleShare = () => {
    setShareExiting(false);
    setShareCopied(true);
    if (isPublic && canvasId) {
      navigator.clipboard.writeText(`${window.location.origin}/view/${canvasId}`);
    }
    setTimeout(() => {
      setShareExiting(true);
      setTimeout(() => { setShareCopied(false); setShareExiting(false); }, 250);
    }, 1400);
  };

  return (
    <>
      {/* Close menu overlay */}
      {menuOpen && <div className="absolute inset-0 z-20" onClick={() => setMenuOpen(false)} />}

      {/* Panel header */}
      <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative p-1.5 text-on-surface-variant">
            <span className="material-symbols-outlined text-lg">account_tree</span>
            <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" />
          </div>
          <span className="font-bold text-sm text-on-surface tracking-tight">Agent Git Log</span>
        </div>
        <div className="flex items-center gap-0.5 -mr-1">
          {/* Publish duplicate */}
          <button
            onClick={onPublishToggle}
            disabled={publishing || !canvasId}
            className={`p-2 transition-colors rounded-full disabled:opacity-40 ${
              isPublic
                ? "text-emerald-600 hover:bg-emerald-50"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60"
            }`}
            title={isPublic ? "Published" : "Publish"}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={{ fontVariationSettings: isPublic ? "'FILL' 1" : "'FILL' 0" }}
            >
              {isPublic ? "public" : "public_off"}
            </span>
          </button>

          {/* Share duplicate */}
          <div className="relative">
            <button
              onClick={handleShare}
              className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 transition-colors rounded-full"
              title="Share"
            >
              <span className="material-symbols-outlined text-lg">share</span>
            </button>
            {shareCopied && (
              <div
                className={`absolute top-full mt-2 right-0 whitespace-nowrap px-3 py-1.5 rounded-full text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-xl z-50 ${
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
                    Publish first
                  </>
                )}
              </div>
            )}
          </div>

          {/* Overflow menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`p-2 transition-colors rounded-full ${
                menuOpen ? "text-on-surface bg-surface-container-high" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60"
              }`}
            >
              <span className="material-symbols-outlined text-lg">more_horiz</span>
            </button>
            {menuOpen && (
              <div className="dropdown-enter absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-outline-variant/15 py-2 z-40">
                <button
                  onClick={() => { setSidebarView("tree"); setMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                    sidebarView === "tree" ? "text-primary bg-primary/5" : "text-on-surface hover:bg-surface-container-high/40"
                  }`}
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant">account_tree</span>
                  Git Tree
                </button>
                <button
                  onClick={() => { setSidebarView("chat"); setMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                    sidebarView === "chat" ? "text-primary bg-primary/5" : "text-on-surface hover:bg-surface-container-high/40"
                  }`}
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant">chat</span>
                  Chat
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onMouseMove={handleMouseMove}
          className="h-full overflow-y-auto px-5 pb-5 no-scrollbar"
        >
          {sidebarView === "chat" ? (
            /* ── Chat View ── */
            <div className="flex flex-col gap-6 pt-4">
              {chatHistory.length === 0 && !chatLoading && (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-4 text-on-surface-variant/40">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/8 to-secondary/8 flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl text-primary/40" style={{ fontVariationSettings: "'FILL' 1" }}>
                      psychology
                    </span>
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-on-surface-variant/60">No active tasks</p>
                    <p className="text-xs text-on-surface-variant/40 max-w-[200px]">
                      Describe a flowchart to start generating or refining diagrams
                    </p>
                  </div>
                </div>
              )}

              {interactions.map((interaction, idx) => (
                <div key={interaction.id} className={`flex flex-col relative ${idx === 0 ? "mt-1" : ""}`}>
                  {interaction.userMessage ? (
                    <>
                      {/* Sticky user pill */}
                      <div className="sticky top-0 z-20 bg-white pt-1 pb-3 -mt-1 group">
                        <div
                          onClick={() => toggleExpand(interaction.id)}
                          className="relative flex items-start justify-between border border-outline-variant/20 rounded-2xl px-3 py-2.5 bg-surface-container-high/80 cursor-pointer hover:bg-surface-container-high transition-colors duration-200"
                        >
                          <div className="flex items-start gap-3 w-full max-w-[calc(100%-24px)]">
                            <span className="material-symbols-outlined text-[22px] text-slate-700 shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1, 'opsz' 20" }}>account_circle</span>
                            <div
                              ref={el => { textContainerRefs.current[interaction.id] = el; }}
                              className={`relative flex-1 min-w-0 transition-[max-height] duration-500 ease-in-out ${
                                expandedPills[interaction.id]
                                  ? "max-h-[300px] overflow-y-auto overflow-x-hidden pr-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-400/60 [&::-webkit-scrollbar-thumb]:rounded-full"
                                  : "max-h-[22px] overflow-hidden"
                              }`}
                              onClick={(e) => { if (expandedPills[interaction.id]) e.stopPropagation(); }}
                            >
                              <div className={`text-on-surface-variant text-sm leading-relaxed transition-opacity duration-300 ${
                                expandedPills[interaction.id] ? "opacity-0 absolute pointer-events-none" : "opacity-100 relative"
                              }`}>
                                <div className="truncate">{interaction.userMessage.content}</div>
                              </div>
                              <div className={`text-on-surface-variant text-sm leading-relaxed whitespace-pre-wrap break-words transition-opacity duration-300 ${
                                expandedPills[interaction.id] ? "opacity-100 relative pb-1" : "opacity-0 absolute pointer-events-none top-0 left-0 w-full"
                              }`}>
                                {interaction.userMessage.content}
                              </div>
                            </div>
                          </div>
                          <span className={`material-symbols-outlined text-on-surface-variant/50 text-lg shrink-0 mt-0.5 transition-transform duration-500 ease-in-out ${
                            expandedPills[interaction.id] ? "rotate-180" : ""
                          }`}>
                            expand_more
                          </span>
                        </div>

                        {/* Restore badge — only when interaction has a snapshot */}
                        {getInteractionSnapshot(interaction) && (
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-0 opacity-0 translate-y-[-8px] group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 z-20 pointer-events-none group-hover:pointer-events-auto flex justify-center">
                            <button
                              onClick={() => onRestore(getInteractionSnapshot(interaction)!)}
                              className="flex items-center gap-1.5 px-3 py-1 bg-white border border-outline-variant/20 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 hover:border-outline-variant/40 text-[11px] font-medium rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-colors"
                            >
                              <span className="material-symbols-outlined text-xs">restore</span>
                              Restore this version
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Assistant responses */}
                      <div className="text-on-surface text-sm leading-relaxed agent-markdown">
                        {interaction.assistantMessages.map((msg, mIdx) => (
                          <div key={mIdx} className={mIdx !== interaction.assistantMessages.length - 1 ? "mb-4" : ""}>
                            <ReactMarkdown>{cleanMessageContent(msg.content)}</ReactMarkdown>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    /* System event (manual edit, restore, etc.) */
                    <div className="flex items-start gap-2.5 group">
                      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary/15 to-secondary/15 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="material-symbols-outlined text-xs text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {sourceIcon(interaction.assistantMessages[0]?.versionSource)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface-variant">
                          {cleanMessageContent(interaction.assistantMessages[0]?.content || "")}
                        </p>
                        <p className="text-[10px] text-on-surface-variant/40 mt-1">
                          {relativeTime(interaction.assistantMessages[0]?.timestamp)}
                        </p>
                      </div>
                      {interaction.assistantMessages[0]?.mermaidSnapshot && (
                        <button
                          onClick={() => onRestore(interaction.assistantMessages[0].mermaidSnapshot!)}
                          className="opacity-0 group-hover:opacity-100 shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-on-surface-variant hover:text-on-surface rounded-full border border-outline-variant/20 hover:bg-surface-container-high/40 transition-all"
                        >
                          <span className="material-symbols-outlined text-xs">restore</span>
                          Restore
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Loading */}
              {chatLoading && (
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary/15 to-secondary/15 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-xs text-primary animate-spin" style={{ fontVariationSettings: "'FILL' 1" }}>progress_activity</span>
                  </div>
                  <div className="bg-surface-container-low/80 rounded-2xl rounded-bl-md px-4 py-3 border border-outline-variant/10">
                    <div className="flex gap-1.5">
                      <div className="w-1.5 h-1.5 bg-primary/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 bg-primary/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 bg-primary/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          ) : (
            /* ── Git Tree View ── */
            <div className="flex flex-col gap-1 pt-4">
              {versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 text-on-surface-variant/40">
                  <span className="material-symbols-outlined text-3xl">account_tree</span>
                  <p className="text-sm font-medium">No versions yet</p>
                  <p className="text-xs text-center max-w-[200px]">Versions are created when the flowchart is updated</p>
                </div>
              ) : (
                versions.map((v, idx) => {
                  const isCurrent = idx === versions.length - 1;
                  let label = v.msg.content;
                  if (v.msg.role === "assistant") {
                    for (let i = v.idx - 1; i >= 0; i--) {
                      if (chatHistory[i].role === "user") {
                        label = chatHistory[i].content;
                        break;
                      }
                    }
                  }
                  const truncLabel = label.length > 50 ? label.slice(0, 50) + "..." : label;

                  return (
                    <button
                      key={v.idx}
                      onClick={() => onRestore(v.msg.mermaidSnapshot!)}
                      className={`group w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                        isCurrent ? "bg-primary/5 border border-primary/15" : "hover:bg-surface-container-high/60"
                      }`}
                    >
                      <div className="flex flex-col items-center shrink-0 self-stretch">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isCurrent ? "bg-primary" : "bg-outline-variant/40 group-hover:bg-primary/60"} transition-colors`} />
                        {idx < versions.length - 1 && <div className="w-px flex-1 bg-outline-variant/20 mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${isCurrent ? "text-primary" : "text-on-surface-variant"}`}>
                            v{v.versionNumber}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full">current</span>
                          )}
                        </div>
                        <p className="text-xs text-on-surface-variant truncate mt-0.5">{truncLabel}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant/40">{sourceIcon(v.msg.versionSource)}</span>
                        <span className="text-[10px] text-on-surface-variant/40 whitespace-nowrap">{relativeTime(v.msg.timestamp)}</span>
                      </div>
                    </button>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Custom scrollbar */}
        {scrollState.height > 0 && (
          <div
            className={`absolute right-1 top-2 bottom-2 w-6 flex justify-end z-10 transition-opacity duration-500 group/scroll ${
              scrollState.show || isDragging ? "opacity-100" : "opacity-0"
            }`}
            onMouseEnter={() => {
              if (timerRef.current) clearTimeout(timerRef.current);
              setScrollState(prev => ({ ...prev, show: true }));
            }}
            onMouseLeave={() => { if (!isDragging) showScrollbarTemporarily(); }}
          >
            <div className="w-full h-full relative">
              <div
                onPointerDown={onPointerDown}
                className={`absolute right-0 bg-gray-300/80 group-hover/scroll:bg-gray-400/90 rounded-full cursor-pointer transition-[width,background-color] duration-300 ease-out ${
                  isDragging ? "w-2.5 bg-gray-400/90" : "w-1.5 group-hover/scroll:w-2.5"
                }`}
                style={{
                  height: `${scrollState.height}px`,
                  transform: `translateY(${scrollState.top}px)`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Model picker — always visible at bottom */}
      <ModelPicker />
    </>
  );
}
