import { useState, useEffect, useCallback } from "react";

import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import { useAuth } from "../hooks/useAuth";
import {
  apiListSkills, apiCreateSkill, apiUpdateSkill, apiDeleteSkill,
  apiGetMarketplace, apiInstallSkill, apiPublishSkill,
  apiGetSharedWithMe, apiShareSkill,
  apiListGroups,
  apiListSkillInstallations, apiUpdateSkillInstallation, apiUninstallSkill, apiRemixSkillInstallation,
} from "../lib/api";
import type { SkillInstallation, SkillNote, UserGroup } from "../types";

const CATEGORIES = ["general", "style", "layout", "content", "review", "optimization", "custom"];

const categoryColors: Record<string, string> = {
  general: "bg-slate-100 text-slate-700",
  style: "bg-violet-100 text-violet-700",
  layout: "bg-sky-100 text-sky-700",
  content: "bg-amber-100 text-amber-700",
  review: "bg-emerald-100 text-emerald-700",
  optimization: "bg-rose-100 text-rose-700",
  custom: "bg-fuchsia-100 text-fuchsia-700",
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${categoryColors[category] || categoryColors.general}`}>
      {category}
    </span>
  );
}

// ── Disclaimer Modal ──
function DisclaimerModal({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-amber-600" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
          </div>
          <h3 className="text-lg font-bold text-on-surface">Safety Disclaimer</h3>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed mb-4">
          Skill Notes contain instructions that guide the AI agent. Before installing, please make sure you <strong>trust the author</strong> and <strong>audit the skill instructions</strong> to avoid harmful or malicious prompt injection.
        </p>
        <p className="text-xs text-on-surface-variant/60 mb-6">
          By clicking "I Understand & Install," you acknowledge that you've reviewed this skill and accept responsibility for its use.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors">
            Cancel
          </button>
          <button onClick={onAccept} className="px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-lg shadow-primary/20">
            I Understand &amp; Install
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New/Edit Skill Panel ──
function SkillEditor({
  skill, onSave, onCancel, saving,
}: {
  skill?: SkillNote | null;
  onSave: (data: { title: string; description: string; instruction_text: string; category: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(skill?.title || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [instructionText, setInstructionText] = useState(skill?.instruction_text || "");
  const [category, setCategory] = useState(skill?.category || "general");

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 animate-in zoom-in-95 fade-in duration-200">
        <h3 className="text-lg font-bold text-on-surface mb-5">{skill ? "Edit Skill Note" : "Craft New Skill Note"}</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Always use rounded nodes"
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description for the marketplace"
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary" />
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${category === c ? "bg-primary text-white shadow-md" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Skill Instructions</label>
            <textarea value={instructionText} onChange={e => setInstructionText(e.target.value)}
              placeholder="Write the instructions the AI agent should follow when this skill is active. E.g., 'Always use TD (top-down) layout. Use rounded rectangle nodes with descriptive labels. Keep flowcharts under 20 nodes.'"
              rows={6}
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary resize-none" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface">Cancel</button>
          <button onClick={() => onSave({ title, description, instruction_text: instructionText, category })}
            disabled={saving || !title.trim() || !instructionText.trim()}
            className="px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-40">
            {saving ? "Saving..." : skill ? "Save Changes" : "Save to Library"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Share Dialog ──
function ShareDialog({ skill, onClose, groups }: { skill: SkillNote; onClose: () => void; groups: UserGroup[] }) {
  const [email, setEmail] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [sharing, setSharing] = useState(false);
  const [msg, setMsg] = useState("");

  const handleShare = async () => {
    setSharing(true);
    setMsg("");
    try {
      if (email.trim()) {
        await apiShareSkill(skill.id, { email: email.trim() });
        setMsg("✅ Shared with user!");
        setEmail("");
      } else if (selectedGroup) {
        await apiShareSkill(skill.id, { group_id: selectedGroup });
        setMsg("✅ Shared with group!");
        setSelectedGroup("");
      }
    } catch (err) {
      setMsg(`❌ ${err instanceof Error ? err.message : "Failed to share"}`);
    } finally { setSharing(false); }
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-200">
        <h3 className="text-lg font-bold text-on-surface mb-4">Share "{skill.title}"</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Share with User (by email)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com"
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary" />
          </div>
          {groups.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Or Share with Group</label>
              <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}
                className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary">
                <option value="">Select a group...</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {msg && <p className="text-sm font-medium">{msg}</p>}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface">Close</button>
          <button onClick={handleShare} disabled={sharing || (!email.trim() && !selectedGroup)}
            className="px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40">
            {sharing ? "Sharing..." : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PublishDialog({
  skill, onClose, onPublish, onUnpublish, saving,
}: {
  skill: SkillNote;
  onClose: () => void;
  onPublish: (opts: { visibility: "public" | "shared"; releaseNotes: string }) => void;
  onUnpublish: () => void;
  saving: boolean;
}) {
  const isReleased = skill.status === "published" || skill.is_published || Boolean(skill.current_published_version_id);
  const nextVersion = (skill.latest_version_number || skill.version || 0) + (isReleased ? 1 : 0);
  const [visibility, setVisibility] = useState<"public" | "shared">(skill.visibility === "shared" ? "shared" : "public");
  const [releaseNotes, setReleaseNotes] = useState("");

  return (
    <div className="fixed inset-0 z-[160] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 animate-in zoom-in-95 fade-in duration-200">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <span className="material-symbols-outlined text-emerald-700" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-on-surface">{isReleased ? "Publish Update" : "Publish Skill"}</h3>
            <p className="text-xs text-on-surface-variant">This creates immutable version v{nextVersion || 1}.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl bg-surface-container-high/70 px-4 py-3">
            <p className="text-sm font-bold text-on-surface">{skill.title}</p>
            {skill.description && <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{skill.description}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Visibility</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setVisibility("public")}
                className={`rounded-xl px-3 py-3 text-left transition-all ${visibility === "public" ? "bg-primary text-white shadow-md" : "bg-surface-container-high text-on-surface hover:bg-surface-container-low"}`}>
                <span className="material-symbols-outlined text-base block mb-1">storefront</span>
                <span className="text-xs font-bold block">Public Marketplace</span>
                <span className="text-[10px] opacity-75">Anyone can discover it.</span>
              </button>
              <button onClick={() => setVisibility("shared")}
                className={`rounded-xl px-3 py-3 text-left transition-all ${visibility === "shared" ? "bg-primary text-white shadow-md" : "bg-surface-container-high text-on-surface hover:bg-surface-container-low"}`}>
                <span className="material-symbols-outlined text-base block mb-1">group</span>
                <span className="text-xs font-bold block">Shared Marketplace</span>
                <span className="text-[10px] opacity-75">Only shared users/groups.</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Release Notes</label>
            <textarea value={releaseNotes} onChange={e => setReleaseNotes(e.target.value)}
              rows={4}
              placeholder={isReleased ? "What changed in this version?" : "Optional notes for the first release"}
              className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary resize-none" />
          </div>

          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-900 leading-relaxed">
            Published versions are immutable. Users who install this skill are pinned to a version, and future updates require them to explicitly update.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-6">
          <div>
            {isReleased && (
              <button onClick={onUnpublish} disabled={saving}
                className="px-3 py-2 text-xs font-bold text-error hover:bg-error-container/20 rounded-lg transition-colors disabled:opacity-40">
                Unpublish
              </button>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface">Cancel</button>
            <button onClick={() => onPublish({ visibility, releaseNotes })} disabled={saving}
              className="px-5 py-2.5 text-sm font-bold bg-primary text-white rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-40">
              {saving ? "Publishing..." : isReleased ? "Publish Update" : "Publish Release"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Skill Card ──
function SkillCard({
  skill, isOwner, onEdit, onDelete, onPublish, onInstall, onOpen, onUpdateInstall, onUninstall, onRemix, onShare, showInstall,
}: {
  skill: SkillNote; isOwner: boolean;
  onEdit?: () => void; onDelete?: () => void;
  onPublish?: () => void; onInstall?: () => void; onOpen?: () => void;
  onUpdateInstall?: () => void; onUninstall?: () => void; onRemix?: () => void; onShare?: () => void;
  showInstall?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group bg-white rounded-2xl border border-outline-variant/15 hover:border-outline-variant/30 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-on-surface text-base truncate">{skill.title}</h3>
            {skill.description && <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{skill.description}</p>}
          </div>
          <div className="flex items-center gap-1 ml-3 shrink-0">
            <span className="material-symbols-outlined text-sm text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
            <span className="text-xs font-bold text-on-surface-variant">{skill.active_usage_count ?? skill.stars ?? 0}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <CategoryBadge category={skill.category} />
          {skill.source_skill_id && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">
              <span className="material-symbols-outlined text-[10px]">download</span>installed
            </span>
          )}
          {(skill.status === "published" || skill.is_published) && isOwner && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">
              <span className="material-symbols-outlined text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>public</span>published
            </span>
          )}
          {skill.visibility === "shared" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700">
              <span className="material-symbols-outlined text-[10px]">group</span>shared
            </span>
          )}
          {skill.has_unpublished_changes && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
              <span className="material-symbols-outlined text-[10px]">edit_note</span>draft changes
            </span>
          )}
          {skill.owner_display_name && !isOwner && (
            <span className="text-[10px] text-on-surface-variant/60 font-medium">by {skill.owner_display_name}</span>
          )}
          {(skill.has_update || skill.relationship === "installed_stale") && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-600 animate-pulse">
              <span className="material-symbols-outlined text-[10px]">update</span>update
            </span>
          )}
          {skill.latest_version_number && (
            <span className="text-[10px] text-on-surface-variant/60 font-medium">v{skill.latest_version_number}</span>
          )}
        </div>

        {/* Expandable instruction preview */}
        <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
          <div className={`text-xs text-on-surface-variant/70 font-mono bg-surface-container-high/50 rounded-lg px-3 py-2 transition-all ${expanded ? "" : "line-clamp-2"}`}>
            {skill.instruction_text}
          </div>
        </button>
      </div>

      {/* Actions */}
      <div className="border-t border-outline-variant/10 px-5 py-3 flex items-center justify-end gap-2">
        {skill.relationship === "installed_current" && onOpen && (
          <button onClick={onOpen} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">open_in_new</span>Open
          </button>
        )}
        {skill.relationship === "installed_stale" && onUpdateInstall && (
          <button onClick={onUpdateInstall} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">update</span>Update
          </button>
        )}
        {showInstall && onInstall && (!skill.relationship || skill.relationship === "not_installed") && (
          <button onClick={onInstall} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">add_circle</span>Install
          </button>
        )}
        {onRemix && (
          <button onClick={onRemix} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">content_copy</span>
          </button>
        )}
        {onUninstall && (
          <button onClick={onUninstall} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-error hover:bg-error-container/20 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">remove_circle</span>
          </button>
        )}
        {isOwner && onShare && (
          <button onClick={onShare} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">share</span>
          </button>
        )}
        {isOwner && onPublish && (
          <button onClick={onPublish}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${(skill.status === "published" || skill.is_published) ? "text-emerald-600 hover:bg-emerald-50" : "text-on-surface-variant hover:text-primary hover:bg-primary/5"}`}>
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: (skill.status === "published" || skill.is_published) ? "'FILL' 1" : "'FILL' 0" }}>
              {(skill.status === "published" || skill.is_published) ? "public" : "public_off"}
            </span>
          </button>
        )}
        {isOwner && onEdit && (
          <button onClick={onEdit} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
        )}
        {isOwner && onDelete && (
          <button onClick={onDelete} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-error hover:bg-error-container/20 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──
export default function SkillsMarketplacePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"drafts" | "published" | "marketplace" | "shared" | "installed">("drafts");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Data
  const [mySkills, setMySkills] = useState<SkillNote[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<SkillNote[]>([]);
  const [sharedSkills, setSharedSkills] = useState<SkillNote[]>([]);
  const [installedSkills, setInstalledSkills] = useState<SkillNote[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Modals
  const [editorSkill, setEditorSkill] = useState<SkillNote | null | undefined>(undefined); // undefined = closed, null = new
  const [saving, setSaving] = useState(false);
  const [disclaimerTarget, setDisclaimerTarget] = useState<SkillNote | null>(null);
  const [shareTarget, setShareTarget] = useState<SkillNote | null>(null);
  const [publishTarget, setPublishTarget] = useState<SkillNote | null>(null);
  const [publishing, setPublishing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [skills, marketplace, shared, grps] = await Promise.all([
        apiListSkills().catch(() => []),
        apiGetMarketplace({ search: search || undefined, category: categoryFilter !== "all" ? categoryFilter : undefined }).catch(() => ({ skills: [] })),
        apiGetSharedWithMe().catch(() => []),
        apiListGroups().catch(() => []),
      ]);
      const installations = await apiListSkillInstallations().catch(() => []);
      setMySkills(skills);
      setMarketplaceSkills(marketplace.skills || []);
      setSharedSkills(shared);
      setInstalledSkills((installations as SkillInstallation[]).map((installation) => ({
        ...(installation.skill_note || {}),
        id: installation.skill_note?.id || installation.skill_note_id,
        title: installation.skill_note?.title || installation.installed_version?.title || "Installed skill",
        description: installation.skill_note?.description || installation.installed_version?.description || "",
        instruction_text: installation.installed_version?.instruction_text || installation.skill_note?.instruction_text || "",
        category: installation.skill_note?.category || installation.installed_version?.category || "general",
        owner_id: installation.skill_note?.owner_id || "",
        is_published: true,
        stars: installation.skill_note?.stars || 0,
        version: installation.installed_version?.version_number || 1,
        source_skill_id: null,
        source_version: null,
        created_at: installation.installed_at,
        updated_at: installation.updated_at,
        relationship: installation.has_update ? "installed_stale" : "installed_current",
        installation_id: installation.id,
        installed_version_id: installation.installed_version_id,
        installed_version_number: installation.installed_version?.version_number,
        latest_version_id: installation.latest_version?.id,
        latest_version_number: installation.latest_version?.version_number,
        has_update: installation.has_update,
        deprecated: Boolean((installation as unknown as { deprecated?: boolean }).deprecated),
      } as SkillNote)));
      setGroups(grps);
    } catch (err) { console.error("Load error:", err); }
    finally { setLoading(false); }
  }, [search, categoryFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async (data: { title: string; description: string; instruction_text: string; category: string }) => {
    setSaving(true);
    try {
      if (editorSkill) {
        await apiUpdateSkill(editorSkill.id, data);
      } else {
        await apiCreateSkill(data);
      }
      setEditorSkill(undefined);
      setMessage(editorSkill ? "Skill saved." : "Skill created.");
      loadData();
    } catch (err) { console.error("Save error:", err); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this skill note? This cannot be undone.")) return;
    try { await apiDeleteSkill(id); setMessage("Skill deleted."); loadData(); } catch (err) { setMessage(err instanceof Error ? err.message : "Delete failed"); console.error(err); }
  };

  const handlePublishRelease = async (opts: { visibility: "public" | "shared"; releaseNotes: string }) => {
    if (!publishTarget) return;
    setPublishing(true);
    try {
      await apiPublishSkill(publishTarget.id, true, opts.visibility, opts.releaseNotes);
      setMessage(opts.visibility === "public" ? "Skill published to Marketplace." : "Skill released to Shared With Me.");
      setPublishTarget(null);
      loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Publish failed");
      console.error(err);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!publishTarget) return;
    if (!confirm("Unpublish this skill? Existing installs keep working, but it will leave marketplace discovery.")) return;
    setPublishing(true);
    try {
      await apiPublishSkill(publishTarget.id, false, "private");
      setMessage("Skill unpublished. Existing installs keep working.");
      setPublishTarget(null);
      loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unpublish failed");
      console.error(err);
    } finally {
      setPublishing(false);
    }
  };

  const handleInstallConfirmed = async () => {
    if (!disclaimerTarget) return;
    try { const result = await apiInstallSkill(disclaimerTarget.id); setDisclaimerTarget(null); setMessage(result.already_installed ? "Already installed." : "Skill installed."); loadData(); }
    catch (err) { console.error(err); setMessage(err instanceof Error ? err.message : "Install failed"); setDisclaimerTarget(null); }
  };

  const handleUpdateInstallation = async (skill: SkillNote) => {
    if (!skill.installation_id) return;
    const updateAttachments = confirm("Update this installed skill? Choose OK to also update all stale canvas attachments using it.");
    try {
      await apiUpdateSkillInstallation(skill.installation_id, updateAttachments);
      setMessage(updateAttachments ? "Installed skill and stale attachments updated." : "Installed skill updated. Existing canvas attachments stay pinned.");
      loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleUninstall = async (skill: SkillNote) => {
    if (!skill.installation_id) return;
    if (!confirm("Uninstall this skill? This removes it from Installed Skills and removes it from every canvas where you use it.")) return;
    try {
      await apiUninstallSkill(skill.installation_id);
      setMessage("Skill uninstalled and removed from canvases.");
      loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Uninstall failed");
    }
  };

  const handleRemix = async (skill: SkillNote) => {
    if (!skill.installation_id) return;
    try {
      await apiRemixSkillInstallation(skill.installation_id);
      setMessage("Private copy created in My Drafts.");
      loadData();
      setActiveTab("drafts");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Copy failed");
    }
  };

  const tabs = [
    { id: "drafts" as const, label: "My Drafts", mobileLabel: "Drafts", icon: "edit_note" },
    { id: "published" as const, label: "My Published", mobileLabel: "Published", icon: "workspace_premium" },
    { id: "marketplace" as const, label: "Marketplace", mobileLabel: "Market", icon: "storefront" },
    { id: "shared" as const, label: "Shared With Me", mobileLabel: "Shared", icon: "group" },
    { id: "installed" as const, label: "Installed", mobileLabel: "Installed", icon: "download_done" },
  ];

  const draftSkills = mySkills.filter(s => !(s.status === "published" || s.is_published || s.current_published_version_id));
  const publishedSkills = mySkills.filter(s => s.status === "published" || s.is_published || s.current_published_version_id);
  const currentSkills = activeTab === "drafts" ? draftSkills :
    activeTab === "published" ? publishedSkills :
    activeTab === "marketplace" ? marketplaceSkills :
    activeTab === "installed" ? installedSkills : sharedSkills;

  const filteredSkills = currentSkills.filter(s =>
    !search || s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-surface text-on-surface min-h-screen pb-32">
      <TopBar showSearch onSearchChange={setSearch} />

      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* Hero */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h1 className="text-5xl font-extrabold tracking-tight text-primary mb-2 font-headline">
              Skill Notes
            </h1>
            <p className="text-on-surface-variant max-w-lg">
              Reusable AI instructions and preferences that shape how IntelliDraw generates your flowcharts. Create, share, and discover skills.
            </p>
          </div>
          <button onClick={() => setEditorSkill(null)}
            className="shrink-0 inline-flex items-center gap-2 px-5 py-3 bg-gradient-to-br from-primary to-primary-container text-white font-bold text-sm rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 active:scale-95 transition-all">
            <span className="material-symbols-outlined text-lg">add</span>
            New Skill
          </button>
        </div>

        {message && (
          <div className="mb-6 rounded-xl bg-surface-container-high px-4 py-3 text-sm font-medium text-on-surface-variant">
            {message}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-surface-container-high/60 backdrop-blur-sm rounded-2xl p-1.5 mb-6 w-full md:w-fit">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 md:flex-none inline-flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.id ? "bg-white text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface hover:bg-white/50"
              }`}>
              <span className="material-symbols-outlined text-xl md:text-base" style={{ fontVariationSettings: activeTab === tab.id ? "'FILL' 1" : "'FILL' 0" }}>{tab.icon}</span>
              <span className="md:hidden">{tab.mobileLabel}</span>
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Category filter (marketplace tab) */}
        {(activeTab === "marketplace" || activeTab === "shared") && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <button onClick={() => setCategoryFilter("all")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${categoryFilter === "all" ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low"}`}>
              All
            </button>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategoryFilter(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all ${categoryFilter === c ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-low"}`}>
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><div className="spinner w-8 h-8" /></div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <span className="material-symbols-outlined text-6xl text-outline-variant/40">
              {activeTab === "marketplace" ? "storefront" : activeTab === "shared" ? "group" : activeTab === "installed" ? "download_done" : activeTab === "published" ? "workspace_premium" : "folder_open"}
            </span>
            <p className="text-on-surface-variant">
              {activeTab === "marketplace" ? "No published skills found" :
                activeTab === "published" ? "You haven't published any skills yet" :
                activeTab === "installed" ? "You haven't installed any skills yet" :
                activeTab === "shared" ? "No skills have been shared with you yet" :
                "Your drafts are empty. Create your first skill!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSkills.map(skill => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isOwner={skill.owner_id === user?.id}
                showInstall={(activeTab === "marketplace" || activeTab === "shared") && skill.owner_id !== user?.id}
                onInstall={() => setDisclaimerTarget(skill)}
                onOpen={skill.installation_id ? () => setActiveTab("installed") : undefined}
                onUpdateInstall={skill.installation_id ? () => handleUpdateInstallation(skill) : undefined}
                onUninstall={activeTab === "installed" && skill.installation_id ? () => handleUninstall(skill) : undefined}
                onRemix={activeTab === "installed" && skill.installation_id ? () => handleRemix(skill) : undefined}
                onEdit={skill.owner_id === user?.id ? () => setEditorSkill(skill) : undefined}
                onDelete={skill.owner_id === user?.id ? () => handleDelete(skill.id) : undefined}
                onPublish={skill.owner_id === user?.id ? () => setPublishTarget(skill) : undefined}
                onShare={skill.owner_id === user?.id ? () => setShareTarget(skill) : undefined}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      {editorSkill !== undefined && (
        <SkillEditor skill={editorSkill} saving={saving} onSave={handleSave} onCancel={() => setEditorSkill(undefined)} />
      )}
      {disclaimerTarget && (
        <DisclaimerModal onAccept={handleInstallConfirmed} onCancel={() => setDisclaimerTarget(null)} />
      )}
      {shareTarget && (
        <ShareDialog skill={shareTarget} groups={groups} onClose={() => { setShareTarget(null); loadData(); }} />
      )}
      {publishTarget && (
        <PublishDialog
          skill={publishTarget}
          saving={publishing}
          onClose={() => setPublishTarget(null)}
          onPublish={handlePublishRelease}
          onUnpublish={handleUnpublish}
        />
      )}

      <BottomNav />
    </div>
  );
}
