import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, CanvasCommit, UserGroup, GroupMember } from "../types";
import ModelPicker from "./ModelPicker";
import { useAuth } from "../hooks/useAuth";
import {
  apiListGroups, apiCreateGroup, apiUpdateGroup, apiDeleteGroup,
  apiAddGroupMember, apiRemoveGroupMember,
} from "../lib/api";

interface AgentGitLogProps {
  chatHistory: ChatMessage[];
  chatLoading: boolean;
  commits: CanvasCommit[];
  onRestore: (mermaidSnapshot: string, versionNumber: number) => void;
  isPublic: boolean;
  canvasId: string | null;
  publishing: boolean;
  onPublishToggle: () => void;
  previewMode: boolean;
  previewVersionNumber: number | null;
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
  commits,
  onRestore,
  isPublic,
  canvasId,
  publishing,
  onPublishToggle,
  previewMode,
  previewVersionNumber,
}: AgentGitLogProps) {
  const { user } = useAuth();
  const [sidebarView, setSidebarView] = useState<"chat" | "tree" | "groups">("chat");
  const [expandedPills, setExpandedPills] = useState<Record<number, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  // Groups inline state
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberMsg, setMemberMsg] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");

  // Groups handlers
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try { setGroups(await apiListGroups()); } catch { /* ignore */ }
    finally { setGroupsLoading(false); }
  }, []);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try { await apiCreateGroup(newGroupName.trim()); setNewGroupName(""); setCreatingGroup(false); loadGroups(); }
    catch (err) { console.error(err); }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("Delete this group?")) return;
    try { await apiDeleteGroup(id); loadGroups(); } catch (err) { console.error(err); }
  };

  const handleUpdateGroup = async (id: string) => {
    if (!editGroupName.trim()) return;
    try { await apiUpdateGroup(id, editGroupName.trim()); setEditingGroupId(null); loadGroups(); }
    catch (err) { console.error(err); }
  };

  const handleAddMember = async (groupId: string) => {
    if (!memberEmail.trim()) return;
    setMemberMsg("");
    try { await apiAddGroupMember(groupId, memberEmail.trim()); setMemberEmail(""); setMemberMsg("✅ Added!"); loadGroups(); }
    catch (err) { setMemberMsg(`❌ ${err instanceof Error ? err.message : "Failed"}`); }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try { await apiRemoveGroupMember(groupId, userId); loadGroups(); } catch (err) { console.error(err); }
  };

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

  // Version list for tree view — now reads from commits, NOT chatHistory
  const versions = useMemo(() => {
    return commits.map((commit, idx) => ({
      id: commit.id,
      versionNumber: idx + 1,
      mermaidCode: commit.mermaid_code,
      source: commit.source,
      commitMessage: commit.commit_message,
      timestamp: commit.created_at,
    }));
  }, [commits]);

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
            <span className="material-symbols-outlined text-lg">
              {sidebarView === "chat" ? "psychology" : sidebarView === "tree" ? "account_tree" : "groups"}
            </span>
            <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white" />
          </div>
          <span className="font-bold text-sm text-on-surface tracking-tight">
            {sidebarView === "chat" ? "Agent Log" : sidebarView === "tree" ? "Git Tree" : "Groups"}
          </span>
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
                <div className="h-px bg-outline-variant/10 mx-2 my-1" />
                <button
                  onClick={() => { setSidebarView("groups"); setMenuOpen(false); loadGroups(); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                    sidebarView === "groups" ? "text-primary bg-primary/5" : "text-on-surface hover:bg-surface-container-high/40"
                  }`}
                >
                  <span className="material-symbols-outlined text-base text-on-surface-variant">groups</span>
                  User Groups
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
          {/* Preview Mode banner */}
          {previewMode && previewVersionNumber !== null && (
            <div className="mt-3 mb-1 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center gap-2 text-amber-800">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                visibility
              </span>
              <span className="text-[11px] font-semibold flex-1">
                Previewing version {previewVersionNumber} — make an edit to restore
              </span>
            </div>
          )}
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
                              onClick={() => onRestore(getInteractionSnapshot(interaction)!, 0)}
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
                          onClick={() => onRestore(interaction.assistantMessages[0].mermaidSnapshot!, 0)}
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
          ) : sidebarView === "groups" ? (
            /* ── Groups View ── */
            <div className="flex flex-col gap-3 pt-4">
              {groupsLoading ? (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-3">
                  <span className="material-symbols-outlined text-xl text-primary animate-spin">progress_activity</span>
                </div>
              ) : groups.length === 0 && !creatingGroup ? (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 text-on-surface-variant/40">
                  <span className="material-symbols-outlined text-3xl">group_add</span>
                  <p className="text-sm font-medium">No groups yet</p>
                  <p className="text-xs text-center max-w-[200px]">Create a group to share skill notes with multiple users at once</p>
                </div>
              ) : (
                groups.map(group => {
                  const isOwner = group.owner_id === user?.id;
                  const isExpanded = expandedGroupId === group.id;
                  const isEditing = editingGroupId === group.id;
                  return (
                    <div key={group.id} className="border border-outline-variant/15 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-container-lowest cursor-pointer hover:bg-surface-container-low transition-colors"
                        onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}>
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>group</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input value={editGroupName} onChange={e => setEditGroupName(e.target.value)} autoFocus
                                onKeyDown={e => e.key === "Enter" && handleUpdateGroup(group.id)}
                                className="flex-1 bg-surface-container-high rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-secondary" />
                              <button onClick={() => handleUpdateGroup(group.id)} className="text-primary text-[10px] font-bold">Save</button>
                              <button onClick={() => setEditingGroupId(null)} className="text-on-surface-variant text-[10px]">✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="text-xs font-semibold text-on-surface truncate block">{group.name}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-on-surface-variant/50">{group.member_count || 0} members</span>
                                {isOwner && <span className="text-[8px] font-bold text-primary uppercase bg-primary/10 px-1 py-0.5 rounded-full">owner</span>}
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                          {isOwner && (
                            <>
                              <button onClick={() => { setEditingGroupId(group.id); setEditGroupName(group.name); }}
                                className="p-1 text-on-surface-variant/40 hover:text-primary rounded-md transition-colors">
                                <span className="material-symbols-outlined text-xs">edit</span>
                              </button>
                              <button onClick={() => handleDeleteGroup(group.id)}
                                className="p-1 text-on-surface-variant/40 hover:text-error rounded-md transition-colors">
                                <span className="material-symbols-outlined text-xs">delete</span>
                              </button>
                            </>
                          )}
                          <span className={`material-symbols-outlined text-on-surface-variant/40 text-sm transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                            expand_more
                          </span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-outline-variant/10 px-3 py-2.5 space-y-1.5 bg-white">
                          {(group.members || []).length === 0 ? (
                            <p className="text-[10px] text-on-surface-variant/50 italic py-1">No members yet</p>
                          ) : (
                            (group.members || []).map((m: GroupMember) => (
                              <div key={m.id} className="flex items-center gap-2.5 py-1 group/member">
                                <div className="w-6 h-6 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                                  {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[11px] font-medium text-on-surface truncate block">{m.display_name || "Unknown"}</span>
                                  <span className="text-[9px] text-on-surface-variant/50 truncate block">{m.email}</span>
                                </div>
                                {isOwner && (
                                  <button onClick={() => handleRemoveMember(group.id, m.user_id)}
                                    className="opacity-0 group-hover/member:opacity-100 p-0.5 text-on-surface-variant/40 hover:text-error rounded-md transition-all">
                                    <span className="material-symbols-outlined text-xs">person_remove</span>
                                  </button>
                                )}
                              </div>
                            ))
                          )}
                          {isOwner && (
                            <div className="pt-1.5 border-t border-outline-variant/10">
                              {addingToGroup === group.id ? (
                                <div className="space-y-1.5">
                                  <div className="flex gap-1.5">
                                    <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)}
                                      placeholder="user@example.com" autoFocus
                                      onKeyDown={e => e.key === "Enter" && handleAddMember(group.id)}
                                      className="flex-1 bg-surface-container-high rounded-lg px-2 py-1.5 text-[10px] outline-none focus:ring-2 focus:ring-secondary" />
                                    <button onClick={() => handleAddMember(group.id)}
                                      className="px-2 py-1.5 text-[10px] font-bold bg-primary text-white rounded-lg active:scale-95 transition-all">Add</button>
                                  </div>
                                  {memberMsg && <p className="text-[10px]">{memberMsg}</p>}
                                  <button onClick={() => { setAddingToGroup(null); setMemberMsg(""); }}
                                    className="text-[10px] text-on-surface-variant hover:text-on-surface">Cancel</button>
                                </div>
                              ) : (
                                <button onClick={() => { setAddingToGroup(group.id); setMemberEmail(""); setMemberMsg(""); }}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors">
                                  <span className="material-symbols-outlined text-xs">person_add</span>Add Member
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {/* Create group */}
              {creatingGroup ? (
                <div className="border border-primary/20 rounded-xl px-3 py-2.5 bg-primary/5">
                  <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                    placeholder="Group name" autoFocus
                    onKeyDown={e => e.key === "Enter" && handleCreateGroup()}
                    className="w-full bg-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-secondary mb-2" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setCreatingGroup(false)} className="text-[10px] font-semibold text-on-surface-variant">Cancel</button>
                    <button onClick={handleCreateGroup} disabled={!newGroupName.trim()}
                      className="px-3 py-1 text-[10px] font-bold bg-primary text-white rounded-lg disabled:opacity-40 active:scale-95 transition-all">Create</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setCreatingGroup(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 border-2 border-dashed border-outline-variant/20 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-primary hover:border-primary/30 transition-colors">
                  <span className="material-symbols-outlined text-sm">add</span>
                  Create Group
                </button>
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
                  const isPreviewing = previewMode && v.versionNumber === previewVersionNumber;
                  const truncLabel = v.commitMessage.length > 50 ? v.commitMessage.slice(0, 50) + "..." : v.commitMessage;

                  return (
                    <button
                      key={v.id}
                      onClick={() => onRestore(v.mermaidCode, v.versionNumber)}
                      className={`group w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                        isPreviewing
                          ? "bg-amber-50 border border-amber-200"
                          : isCurrent
                            ? "bg-primary/5 border border-primary/15"
                            : "hover:bg-surface-container-high/60"
                      }`}
                    >
                      <div className="flex flex-col items-center shrink-0 self-stretch">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          isPreviewing
                            ? "bg-amber-500"
                            : isCurrent
                              ? "bg-primary"
                              : "bg-outline-variant/40 group-hover:bg-primary/60"
                        } transition-colors`} />
                        {idx < versions.length - 1 && <div className="w-px flex-1 bg-outline-variant/20 mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${
                            isPreviewing
                              ? "text-amber-700"
                              : isCurrent
                                ? "text-primary"
                                : "text-on-surface-variant"
                          }`}>
                            v{v.versionNumber}
                          </span>
                          {isPreviewing && (
                            <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider bg-amber-100 px-1.5 py-0.5 rounded-full">previewing</span>
                          )}
                          {isCurrent && !isPreviewing && (
                            <span className="text-[9px] font-bold text-primary uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full">current</span>
                          )}
                        </div>
                        <p className="text-xs text-on-surface-variant truncate mt-0.5">{truncLabel}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant/40">{sourceIcon(v.source)}</span>
                        <span className="text-[10px] text-on-surface-variant/40 whitespace-nowrap">{relativeTime(v.timestamp)}</span>
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
