import { useState, useEffect, useCallback } from "react";
import {
  apiGetSkillAttachments, apiAttachSkill, apiToggleAttachment,
  apiDetachSkill, apiTriggerSkill, apiListSkills,
  apiListSkillInstallations, apiUpdateAttachmentVersion,
  apiUpdateAttachmentSettings,
} from "../lib/api";
import PlanBadge from "./PlanBadge";
import { useEntitlements } from "../hooks/useEntitlements";
import type { SkillInstallation, SkillNoteAttachment, SkillNote, SkillScope, SkillTriggerMode } from "../types";

interface CanvasSkillsPanelProps {
  canvasId: string;
  isOpen: boolean;
  onClose: () => void;
  inputBarHeight?: number;
  onSkillTriggered: (result: { updatedMermaidCode: string | null; response: string; skillTitle: string }) => void;
  onAddSkillToContext: (skill: { title: string; instructionText: string }) => void;
}

const scopeLabel: Record<SkillScope, string> = { local: "Canvas", global: "Global" };
const modeLabel: Record<SkillTriggerMode, string> = { automatic: "Auto", manual: "Manual", contextual: "Context" };
const modeDisplayLabel: Record<SkillTriggerMode, string> = {
  automatic: "Automatic execution",
  manual: "Manual trigger",
  contextual: "Context provider",
};
const scopeIcon: Record<SkillScope, string> = { local: "draw", global: "public" };
const modeDotClass: Record<SkillTriggerMode, string> = {
  automatic: "bg-emerald-500",
  manual: "bg-amber-500",
  contextual: "bg-indigo-500",
};

export default function CanvasSkillsPanel({
  canvasId,
  isOpen,
  onClose,
  inputBarHeight = 60,
  onSkillTriggered,
  onAddSkillToContext,
}: CanvasSkillsPanelProps) {
  const [attachments, setAttachments] = useState<SkillNoteAttachment[]>([]);
  const [mySkills, setMySkills] = useState<SkillNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [expandedAttachmentId, setExpandedAttachmentId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [updatesMap, setUpdatesMap] = useState<Record<string, boolean>>({});
  const [panelMessage, setPanelMessage] = useState("");
  const { hasFeature, getRequiredPlan, getPlanName } = useEntitlements();

  const [addSkillId, setAddSkillId] = useState("");
  const [addScope, setAddScope] = useState<SkillScope>("local");
  const [addMode, setAddMode] = useState<SkillTriggerMode>("manual");

  const scopeFeature = useCallback((scope: SkillScope) => (
    scope === "global" ? "skills.attach_global" : "skills.attach_canvas"
  ), []);
  const modeFeature = useCallback((mode: SkillTriggerMode) => (
    mode === "automatic" ? "skills.trigger_automatic" : mode === "contextual" ? "skills.trigger_contextual" : "skills.trigger_manual"
  ), []);
  const requiredPlanMessage = useCallback((featureKey: string, label: string) => {
    const plan = getRequiredPlan(featureKey);
    return plan && plan !== "free" ? `${label} requires ${getPlanName(plan)}.` : `${label} is not available on your current plan.`;
  }, [getPlanName, getRequiredPlan]);

  const loadAttachments = useCallback(async () => {
    if (!canvasId) return;
    setLoading(true);
    try {
      const data = await apiGetSkillAttachments(canvasId);
      setAttachments(data || []);
      const updates: Record<string, boolean> = {};
      for (const att of (data || [])) {
        if (att.has_update && att.id) updates[att.id] = true;
      }
      setUpdatesMap(updates);
    } catch (err) { console.error("Failed to load attachments:", err); }
    finally { setLoading(false); }
  }, [canvasId]);

  const loadMySkills = useCallback(async () => {
    try {
      const [owned, installations] = await Promise.all([
        apiListSkills().catch(() => []),
        apiListSkillInstallations().catch(() => []),
      ]);
      const installedOptions = (installations as SkillInstallation[]).map((installation) => ({
        ...(installation.skill_note || {}),
        id: `installation:${installation.id}`,
        owner_id: installation.skill_note?.owner_id || "",
        title: installation.skill_note?.title || installation.installed_version?.title || "Installed skill",
        description: installation.skill_note?.description || installation.installed_version?.description || "",
        instruction_text: installation.installed_version?.instruction_text || "",
        category: installation.skill_note?.category || installation.installed_version?.category || "general",
        is_published: true,
        version: installation.installed_version?.version_number || 1,
        source_skill_id: null,
        source_version: null,
        created_at: installation.installed_at,
        updated_at: installation.updated_at,
      } as SkillNote));
      setMySkills([...(owned || []), ...installedOptions]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isOpen) { loadAttachments(); loadMySkills(); }
  }, [isOpen, loadAttachments, loadMySkills]);

  const updateAttachmentInState = (updated: SkillNoteAttachment) => {
    setAttachments(prev => prev.map(a => a.id === updated.id ? updated : a));
  };

  const handleToggle = async (att: SkillNoteAttachment) => {
    try {
      const updated = await apiToggleAttachment(att.id, !att.is_active);
      updateAttachmentInState(updated);
      setPanelMessage("");
    } catch (err) {
      console.error(err);
      setPanelMessage(err instanceof Error ? err.message : "Failed to update attachment");
    }
  };

  const handleUpdateSettings = async (
    att: SkillNoteAttachment,
    updates: { scope?: SkillScope; trigger_mode?: SkillTriggerMode },
  ) => {
    if (updates.scope && !hasFeature(scopeFeature(updates.scope))) {
      setPanelMessage(requiredPlanMessage(scopeFeature(updates.scope), `${scopeLabel[updates.scope]} skills`));
      return;
    }
    if (updates.trigger_mode && !hasFeature(modeFeature(updates.trigger_mode))) {
      setPanelMessage(requiredPlanMessage(modeFeature(updates.trigger_mode), modeDisplayLabel[updates.trigger_mode]));
      return;
    }

    const optimisticAttachment: SkillNoteAttachment = {
      ...att,
      ...updates,
      canvas_id: updates.scope === "local" ? canvasId : updates.scope === "global" ? null : att.canvas_id,
    };
    updateAttachmentInState(optimisticAttachment);
    setPanelMessage("");

    try {
      const updated = await apiUpdateAttachmentSettings(att.id, {
        ...updates,
        canvas_id: updates.scope === "local" ? canvasId : updates.scope === "global" ? null : undefined,
      });
      updateAttachmentInState(updated);
      setPanelMessage("");
    } catch (err) {
      console.error(err);
      updateAttachmentInState(att);
      setPanelMessage(err instanceof Error ? err.message : "Failed to update attachment settings");
    }
  };

  const handleDetach = async (id: string) => {
    try {
      await apiDetachSkill(id);
      setExpandedAttachmentId(prev => prev === id ? null : prev);
      setAttachments(prev => prev.filter(a => a.id !== id));
      setPanelMessage("");
    } catch (err) {
      console.error(err);
      setPanelMessage(err instanceof Error ? err.message : "Failed to remove skill");
    }
  };

  const handleTrigger = async (attachmentId: string) => {
    if (!hasFeature("skills.trigger_manual")) {
      setPanelMessage(requiredPlanMessage("skills.trigger_manual", "Manual skill triggers"));
      return;
    }
    setTriggeringId(attachmentId);
    try {
      const att = attachments.find(a => a.id === attachmentId);
      if (!att?.skill_note_id) return;
      const result = await apiTriggerSkill(att.skill_note_id, canvasId, att.attached_version_id);
      onSkillTriggered(result);
    } catch (err) { console.error(err); }
    finally { setTriggeringId(null); }
  };

  const handleAddToContext = (attachmentId: string) => {
    if (!hasFeature("skills.trigger_contextual")) {
      setPanelMessage(requiredPlanMessage("skills.trigger_contextual", "Contextual skills"));
      return;
    }
    const att = attachments.find(a => a.id === attachmentId);
    const skill = att?.skill_note;
    if (!skill?.instruction_text) return;
    onAddSkillToContext({ title: skill.title || "Skill", instructionText: skill.instruction_text });
  };

  const handleSync = async (attachmentId: string) => {
    setSyncingId(attachmentId);
    try {
      await apiUpdateAttachmentVersion(attachmentId);
      setUpdatesMap(prev => ({ ...prev, [attachmentId]: false }));
      loadAttachments();
    } catch (err) { console.error(err); }
    finally { setSyncingId(null); }
  };

  const handleAdd = async () => {
    if (!addSkillId) return;
    if (!hasFeature(scopeFeature(addScope))) {
      setPanelMessage(requiredPlanMessage(scopeFeature(addScope), `${scopeLabel[addScope]} skills`));
      return;
    }
    if (!hasFeature(modeFeature(addMode))) {
      setPanelMessage(requiredPlanMessage(modeFeature(addMode), modeDisplayLabel[addMode]));
      return;
    }
    try {
      const isInstallation = addSkillId.startsWith("installation:");
      const installationId = isInstallation ? addSkillId.replace("installation:", "") : undefined;
      const existing = attachments.find(att =>
        att.scope === addScope &&
        (isInstallation ? att.skill_installation_id === installationId : att.skill_note_id === addSkillId)
      );

      if (existing) {
        const updated = await apiUpdateAttachmentSettings(existing.id, {
          trigger_mode: addMode,
          scope: addScope,
          canvas_id: addScope === "local" ? canvasId : null,
        });
        updateAttachmentInState(updated);
        setShowAddDialog(false);
        setAddSkillId("");
        setPanelMessage("Existing attachment updated.");
        return;
      }

      const newAtt = await apiAttachSkill({
        skill_note_id: isInstallation ? undefined : addSkillId,
        skill_installation_id: installationId,
        canvas_id: addScope === "local" ? canvasId : undefined,
        scope: addScope,
        trigger_mode: addMode,
      });
      setAttachments(prev => [...prev, newAtt]);
      setShowAddDialog(false);
      setAddSkillId("");
      setPanelMessage("");
    } catch (err) {
      console.error(err);
      setPanelMessage(err instanceof Error ? err.message : "Failed to attach skill");
    }
  };

  const canvasAtts = attachments.filter(a => a.scope === "local");
  const globalAtts = attachments.filter(a => a.scope === "global");

  if (!isOpen) return null;

  const panelBottomOffset = Math.max(80, inputBarHeight + 32);

  return (
    <div className="skills-panel absolute left-4 bottom-0 z-50 w-[340px] max-h-[70vh] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-outline-variant/20 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
      style={{ bottom: `${panelBottomOffset}px`, zIndex: 10020 }}>
      <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-lg text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          <span className="font-bold text-sm text-on-surface truncate">Canvas Skills</span>
          <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container-high px-1.5 py-0.5 rounded-full shrink-0">
            {attachments.filter(a => a.is_active).length} active
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              setIsEditing(prev => {
                if (prev) setExpandedAttachmentId(null);
                return !prev;
              });
            }}
            className={`p-1.5 rounded-lg transition-colors ${isEditing ? "bg-primary text-white" : "text-on-surface-variant hover:text-primary hover:bg-primary/5"}`}
            title={isEditing ? "Done editing" : "Edit attachments"}
            aria-label={isEditing ? "Done editing" : "Edit attachments"}
          >
            <span className="material-symbols-outlined text-lg">{isEditing ? "check" : "edit"}</span>
          </button>
          <button onClick={() => { setShowAddDialog(true); loadMySkills(); }}
            className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
            title="Add Skill">
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
          <button onClick={onClose} className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-lg transition-colors" title="Close">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
        {panelMessage && (
          <div className="rounded-lg bg-surface-container-high/70 px-3 py-2 text-[11px] font-semibold text-on-surface-variant">
            {panelMessage}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-8"><div className="spinner w-6 h-6" /></div>
        ) : attachments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-on-surface-variant/40">
            <span className="material-symbols-outlined text-3xl">auto_awesome</span>
            <p className="text-xs font-medium text-center">No skills attached to this canvas.<br />Add one to shape the AI's behavior.</p>
          </div>
        ) : (
          <>
            <AttachmentSection
              title="Canvas Skills"
              icon={scopeIcon.local}
              attachments={canvasAtts}
              isEditing={isEditing}
              expandedAttachmentId={expandedAttachmentId}
              setExpandedAttachmentId={setExpandedAttachmentId}
              triggeringId={triggeringId}
              syncingId={syncingId}
              updatesMap={updatesMap}
              onToggle={handleToggle}
              onDetach={handleDetach}
              onTrigger={handleTrigger}
              onAddToContext={handleAddToContext}
              onSync={handleSync}
              onUpdateSettings={handleUpdateSettings}
            />
            <AttachmentSection
              title="Global Skills"
              icon="public"
              attachments={globalAtts}
              isEditing={isEditing}
              expandedAttachmentId={expandedAttachmentId}
              setExpandedAttachmentId={setExpandedAttachmentId}
              triggeringId={triggeringId}
              syncingId={syncingId}
              updatesMap={updatesMap}
              onToggle={handleToggle}
              onDetach={handleDetach}
              onTrigger={handleTrigger}
              onAddToContext={handleAddToContext}
              onSync={handleSync}
              onUpdateSettings={handleUpdateSettings}
            />
          </>
        )}
      </div>

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
                    disabled={!hasFeature(scopeFeature(s))}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all disabled:opacity-50 ${addScope === s ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                    {scopeLabel[s]}
                    {!hasFeature(scopeFeature(s)) && <PlanBadge planId={getRequiredPlan(scopeFeature(s))} className="ml-1" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">Mode</label>
              <div className="flex gap-1">
                {(["automatic", "manual", "contextual"] as const).map(m => (
                  <button key={m} onClick={() => setAddMode(m)}
                    disabled={!hasFeature(modeFeature(m))}
                    className={`flex-1 px-1 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all disabled:opacity-50 ${addMode === m ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                    {modeLabel[m]}
                    {!hasFeature(modeFeature(m)) && <PlanBadge planId={getRequiredPlan(modeFeature(m))} className="ml-1" />}
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

function AttachmentSection({
  title,
  icon,
  attachments,
  isEditing,
  expandedAttachmentId,
  setExpandedAttachmentId,
  triggeringId,
  syncingId,
  updatesMap,
  onToggle,
  onDetach,
  onTrigger,
  onAddToContext,
  onSync,
  onUpdateSettings,
}: {
  title: string;
  icon: string;
  attachments: SkillNoteAttachment[];
  isEditing: boolean;
  expandedAttachmentId: string | null;
  setExpandedAttachmentId: (id: string | null | ((current: string | null) => string | null)) => void;
  triggeringId: string | null;
  syncingId: string | null;
  updatesMap: Record<string, boolean>;
  onToggle: (att: SkillNoteAttachment) => void;
  onDetach: (id: string) => void;
  onTrigger: (attachmentId: string) => void;
  onAddToContext: (attachmentId: string) => void;
  onSync: (attachmentId: string) => void;
  onUpdateSettings: (att: SkillNoteAttachment, updates: { scope?: SkillScope; trigger_mode?: SkillTriggerMode }) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="material-symbols-outlined text-xs text-on-surface-variant/50">{icon}</span>
        <span className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-1.5">
        {attachments.map(att => (
          <AttachmentRow
            key={att.id}
            att={att}
            hasUpdate={updatesMap[att.id]}
            isEditing={isEditing}
            isExpanded={expandedAttachmentId === att.id}
            triggeringId={triggeringId}
            syncingId={syncingId}
            onToggle={onToggle}
            onDetach={onDetach}
            onTrigger={onTrigger}
            onAddToContext={onAddToContext}
            onSync={onSync}
            onToggleSettings={(id) => setExpandedAttachmentId(current => current === id ? null : id)}
            onUpdateSettings={onUpdateSettings}
          />
        ))}
      </div>
    </div>
  );
}

function AttachmentRow({
  att,
  hasUpdate,
  isEditing,
  isExpanded,
  triggeringId,
  syncingId,
  onToggle,
  onDetach,
  onTrigger,
  onAddToContext,
  onSync,
  onToggleSettings,
  onUpdateSettings,
}: {
  att: SkillNoteAttachment;
  hasUpdate?: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  triggeringId: string | null;
  syncingId: string | null;
  onToggle: (att: SkillNoteAttachment) => void;
  onDetach: (id: string) => void;
  onTrigger: (attachmentId: string) => void;
  onAddToContext: (attachmentId: string) => void;
  onSync: (attachmentId: string) => void;
  onToggleSettings: (attachmentId: string) => void;
  onUpdateSettings: (att: SkillNoteAttachment, updates: { scope?: SkillScope; trigger_mode?: SkillTriggerMode }) => void;
}) {
  const skill = att.skill_note;
  const isTriggering = triggeringId === att.id;
  const isSyncing = syncingId === att.id;

  return (
    <div className={`px-3 py-2.5 rounded-xl transition-all border ${att.is_active ? "bg-primary/5 border-primary/10" : "bg-surface-container-high/40 border-transparent"} ${isExpanded ? "bg-white/95" : ""}`}>
      <div className="flex items-center gap-2.5">
        <button onClick={() => onToggle(att)} className="shrink-0"
          title={att.is_active ? "Disable" : "Enable"}>
          <div className={`w-8 h-[18px] rounded-full flex items-center transition-all duration-200 ${att.is_active ? "bg-primary justify-end" : "bg-outline-variant/30 justify-start"}`}>
            <div className="w-3.5 h-3.5 rounded-full mx-0.5 bg-white transition-all" />
          </div>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-on-surface truncate">{skill?.title || "Unknown"}</span>
            {hasUpdate && (
              <button onClick={() => onSync(att.id)} disabled={isSyncing}
                className="shrink-0" title="Update available">
                <span className={`material-symbols-outlined text-xs text-orange-500 ${isSyncing ? "animate-spin" : "animate-pulse"}`}>
                  {isSyncing ? "progress_activity" : "update"}
                </span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-surface-container-high/75 px-1.5 py-0.5 text-[11px] font-bold text-[#53657c] leading-tight">
              <span className={`h-1.5 w-1.5 rounded-full ${modeDotClass[att.trigger_mode]}`} />
              {modeDisplayLabel[att.trigger_mode]}
            </span>
            <span className="material-symbols-outlined text-[11px] text-on-surface-variant/40">{scopeIcon[att.scope]}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isEditing ? (
            <button
              onClick={() => onToggleSettings(att.id)}
              className={`h-10 w-10 flex items-center justify-center rounded-xl transition-colors ${isExpanded ? "bg-primary/10 text-primary" : "text-on-surface-variant/50 hover:text-primary hover:bg-primary/5"}`}
              title={isExpanded ? "Hide settings" : "Show settings"}
              aria-expanded={isExpanded}
            >
              <span className="material-symbols-outlined text-[26px]">{isExpanded ? "expand_less" : "expand_more"}</span>
            </button>
          ) : (
            <>
              {att.trigger_mode === "manual" && (
                <button onClick={() => onTrigger(att.id)} disabled={isTriggering || !att.is_active}
                  className="h-10 w-10 flex items-center justify-center text-primary bg-primary/5 hover:bg-primary/10 rounded-xl transition-colors disabled:opacity-35" title="Run Skill">
                  <span className={`material-symbols-outlined text-[24px] ${isTriggering ? "animate-spin" : ""}`}>
                    {isTriggering ? "progress_activity" : "play_arrow"}
                  </span>
                </button>
              )}
              {att.trigger_mode === "contextual" && (
                <button onClick={() => onAddToContext(att.id)} disabled={!att.is_active}
                  className="h-10 w-10 flex items-center justify-center text-primary bg-primary/5 hover:bg-primary/10 rounded-xl transition-colors disabled:opacity-35" title="Add to Context">
                  <span className="material-symbols-outlined text-[23px]">post_add</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isEditing && isExpanded && (
        <div className="mt-2 rounded-lg bg-surface-container-high/50 p-2.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase">Attachment Settings</span>
            <button onClick={() => onDetach(att.id)}
              className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-error/15 text-[11px] font-bold uppercase text-error/80 hover:bg-error/5 hover:border-error/25 transition-colors"
              title="Remove skill">
              <span className="material-symbols-outlined text-base">delete</span>
              Delete
            </button>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">Scope</label>
            <div className="flex gap-1">
              {(["local", "global"] as const).map(scope => (
                <button key={scope} onClick={() => onUpdateSettings(att, { scope })}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${att.scope === scope ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                  <span className="material-symbols-outlined text-[13px] mr-1">{scopeIcon[scope]}</span>
                  {scopeLabel[scope]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant/60 uppercase mb-1">Mode</label>
            <div className="flex gap-1">
              {(["automatic", "manual", "contextual"] as const).map(mode => (
                <button key={mode} onClick={() => onUpdateSettings(att, { trigger_mode: mode })}
                  className={`flex-1 px-1 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${att.trigger_mode === mode ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant"}`}>
                  {modeLabel[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
