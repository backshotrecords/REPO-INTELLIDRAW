import { useState, useEffect, useCallback } from "react";
import {
  apiGetSkillAttachments, apiAttachSkill, apiToggleAttachment,
  apiDetachSkill, apiTriggerSkill, apiListSkills, apiCheckSkillUpdate, apiSyncSkill,
} from "../lib/api";
import type { SkillNoteAttachment, SkillNote } from "../types";

interface CanvasSkillsPanelProps {
  canvasId: string;
  isOpen: boolean;
  onClose: () => void;
  onSkillTriggered: (result: { updatedMermaidCode: string | null; response: string; skillTitle: string }) => void;
}

const scopeLabel = { local: "Project", global: "Global" };
const modeLabel = { automatic: "Auto", manual: "Manual" };
const scopeIcon = { local: "folder", global: "public" };

export default function CanvasSkillsPanel({ canvasId, isOpen, onClose, onSkillTriggered }: CanvasSkillsPanelProps) {
  const [attachments, setAttachments] = useState<SkillNoteAttachment[]>([]);
  const [mySkills, setMySkills] = useState<SkillNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [updatesMap, setUpdatesMap] = useState<Record<string, boolean>>({});

  // Add skill form
  const [addSkillId, setAddSkillId] = useState("");
  const [addScope, setAddScope] = useState<"local" | "global">("local");
  const [addMode, setAddMode] = useState<"automatic" | "manual">("automatic");

  const loadAttachments = useCallback(async () => {
    if (!canvasId) return;
    setLoading(true);
    try {
      const data = await apiGetSkillAttachments(canvasId);
      setAttachments(data || []);
      // Check for updates on installed skills
      const updates: Record<string, boolean> = {};
      for (const att of (data || [])) {
        if (att.skill_note?.source_skill_id) {
          try {
            const result = await apiCheckSkillUpdate(att.skill_note_id);
            if (result.has_update) updates[att.skill_note_id] = true;
          } catch { /* ignore */ }
        }
      }
      setUpdatesMap(updates);
    } catch (err) { console.error("Failed to load attachments:", err); }
    finally { setLoading(false); }
  }, [canvasId]);

  const loadMySkills = useCallback(async () => {
    try { setMySkills(await apiListSkills()); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isOpen) { loadAttachments(); loadMySkills(); }
  }, [isOpen, loadAttachments, loadMySkills]);

  const handleToggle = async (att: SkillNoteAttachment) => {
    try {
      const updated = await apiToggleAttachment(att.id, !att.is_active);
      setAttachments(prev => prev.map(a => a.id === att.id ? updated : a));
    } catch (err) { console.error(err); }
  };

  const handleDetach = async (id: string) => {
    try {
      await apiDetachSkill(id);
      setAttachments(prev => prev.filter(a => a.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleTrigger = async (skillNoteId: string) => {
    setTriggeringId(skillNoteId);
    try {
      const result = await apiTriggerSkill(skillNoteId, canvasId);
      onSkillTriggered(result);
    } catch (err) { console.error(err); }
    finally { setTriggeringId(null); }
  };

  const handleSync = async (skillNoteId: string) => {
    setSyncingId(skillNoteId);
    try {
      await apiSyncSkill(skillNoteId);
      setUpdatesMap(prev => ({ ...prev, [skillNoteId]: false }));
      loadAttachments();
    } catch (err) { console.error(err); }
    finally { setSyncingId(null); }
  };

  const handleAdd = async () => {
    if (!addSkillId) return;
    try {
      const newAtt = await apiAttachSkill({
        skill_note_id: addSkillId,
        canvas_id: addScope === "local" ? canvasId : undefined,
        scope: addScope,
        trigger_mode: addMode,
      });
      setAttachments(prev => [...prev, newAtt]);
      setShowAddDialog(false);
      setAddSkillId("");
    } catch (err) { console.error(err); }
  };

  // Separate local and global
  const localAtts = attachments.filter(a => a.scope === "local");
  const globalAtts = attachments.filter(a => a.scope === "global");

  if (!isOpen) return null;

  return (
    <div className="skills-panel absolute left-4 bottom-0 z-50 w-[340px] max-h-[70vh] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-outline-variant/20 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
      style={{ bottom: "80px" }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          <span className="font-bold text-sm text-on-surface">Canvas Skills</span>
          <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container-high px-1.5 py-0.5 rounded-full">
            {attachments.filter(a => a.is_active).length} active
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowAddDialog(true); loadMySkills(); }}
            className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
            title="Add Skill">
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
          <button onClick={onClose} className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
        {loading ? (
          <div className="flex justify-center py-8"><div className="spinner w-6 h-6" /></div>
        ) : attachments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-on-surface-variant/40">
            <span className="material-symbols-outlined text-3xl">auto_awesome</span>
            <p className="text-xs font-medium text-center">No skills attached to this canvas.<br />Add one to shape the AI's behavior.</p>
          </div>
        ) : (
          <>
            {/* Local Skills */}
            {localAtts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-xs text-on-surface-variant/50">folder</span>
                  <span className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Project Skills</span>
                </div>
                <div className="space-y-1.5">
                  {localAtts.map(att => (
                    <AttachmentRow key={att.id} att={att} hasUpdate={updatesMap[att.skill_note_id]}
                      triggeringId={triggeringId} syncingId={syncingId}
                      onToggle={handleToggle} onDetach={handleDetach} onTrigger={handleTrigger} onSync={handleSync} />
                  ))}
                </div>
              </div>
            )}

            {/* Global Skills */}
            {globalAtts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-xs text-on-surface-variant/50">public</span>
                  <span className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Global Skills</span>
                </div>
                <div className="space-y-1.5">
                  {globalAtts.map(att => (
                    <AttachmentRow key={att.id} att={att} hasUpdate={updatesMap[att.skill_note_id]}
                      triggeringId={triggeringId} syncingId={syncingId}
                      onToggle={handleToggle} onDetach={handleDetach} onTrigger={handleTrigger} onSync={handleSync} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Skill Dialog */}
      {showAddDialog && (
        <div className="border-t border-outline-variant/10 px-4 py-4 bg-surface-container-lowest shrink-0">
          <h4 className="text-xs font-bold text-on-surface uppercase mb-3">Attach Skill</h4>
          <select value={addSkillId} onChange={e => setAddSkillId(e.target.value)}
            className="w-full bg-surface-container-high border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-secondary mb-2">
            <option value="">Select a skill from your library...</option>
            {mySkills.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">Scope</label>
              <div className="flex gap-1">
                {(["local", "global"] as const).map(s => (
                  <button key={s} onClick={() => setAddScope(s)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${addScope === s ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                    {scopeLabel[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">Mode</label>
              <div className="flex gap-1">
                {(["automatic", "manual"] as const).map(m => (
                  <button key={m} onClick={() => setAddMode(m)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${addMode === m ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                    {modeLabel[m]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddDialog(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant">Cancel</button>
            <button onClick={handleAdd} disabled={!addSkillId}
              className="px-4 py-1.5 text-xs font-bold bg-primary text-white rounded-lg disabled:opacity-40 active:scale-95 transition-all">
              Attach
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single attachment row ──
function AttachmentRow({ att, hasUpdate, triggeringId, syncingId, onToggle, onDetach, onTrigger, onSync }: {
  att: SkillNoteAttachment; hasUpdate?: boolean;
  triggeringId: string | null; syncingId: string | null;
  onToggle: (att: SkillNoteAttachment) => void;
  onDetach: (id: string) => void;
  onTrigger: (skillNoteId: string) => void;
  onSync: (skillNoteId: string) => void;
}) {
  const skill = att.skill_note;
  const isTriggering = triggeringId === att.skill_note_id;
  const isSyncing = syncingId === att.skill_note_id;

  return (
    <div className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all ${att.is_active ? "bg-primary/5 border border-primary/10" : "bg-surface-container-high/40 border border-transparent"}`}>
      {/* Toggle */}
      <button onClick={() => onToggle(att)} className="shrink-0"
        title={att.is_active ? "Disable" : "Enable"}>
        <div className={`w-8 h-[18px] rounded-full flex items-center transition-all duration-200 ${att.is_active ? "bg-primary justify-end" : "bg-outline-variant/30 justify-start"}`}>
          <div className={`w-3.5 h-3.5 rounded-full mx-0.5 transition-all ${att.is_active ? "bg-white" : "bg-white"}`} />
        </div>
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-on-surface truncate">{skill?.title || "Unknown"}</span>
          {hasUpdate && (
            <button onClick={() => onSync(att.skill_note_id)} disabled={isSyncing}
              className="shrink-0" title="Update available">
              <span className={`material-symbols-outlined text-xs text-orange-500 ${isSyncing ? "animate-spin" : "animate-pulse"}`}>
                {isSyncing ? "progress_activity" : "update"}
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${att.trigger_mode === "automatic" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {modeLabel[att.trigger_mode]}
          </span>
          <span className="material-symbols-outlined text-[10px] text-on-surface-variant/40">{scopeIcon[att.scope]}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {att.trigger_mode === "manual" && (
          <button onClick={() => onTrigger(att.skill_note_id)} disabled={isTriggering}
            className="p-1 text-primary hover:bg-primary/10 rounded-md transition-colors" title="Run Skill">
            <span className={`material-symbols-outlined text-sm ${isTriggering ? "animate-spin" : ""}`}>
              {isTriggering ? "progress_activity" : "play_arrow"}
            </span>
          </button>
        )}
        <button onClick={() => onDetach(att.id)}
          className="p-1 text-on-surface-variant/40 hover:text-error hover:bg-error/5 rounded-md transition-colors" title="Remove">
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    </div>
  );
}
