import { useState, useEffect, useCallback } from "react";

import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import { useAuth } from "../hooks/useAuth";
import {
  apiListSkills, apiCreateSkill, apiUpdateSkill, apiDeleteSkill,
  apiGetMarketplace, apiInstallSkill, apiPublishSkill,
  apiGetSharedWithMe, apiShareSkill,
  apiListGroups,
} from "../lib/api";
import type { SkillNote, UserGroup } from "../types";

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

// ── Skill Card ──
function SkillCard({
  skill, isOwner, onEdit, onDelete, onPublish, onInstall, onShare, showInstall,
}: {
  skill: SkillNote; isOwner: boolean;
  onEdit?: () => void; onDelete?: () => void;
  onPublish?: (pub: boolean) => void; onInstall?: () => void; onShare?: () => void;
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
            <span className="material-symbols-outlined text-sm text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
            <span className="text-xs font-bold text-on-surface-variant">{skill.stars}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <CategoryBadge category={skill.category} />
          {skill.source_skill_id && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">
              <span className="material-symbols-outlined text-[10px]">download</span>installed
            </span>
          )}
          {skill.is_published && isOwner && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">
              <span className="material-symbols-outlined text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>public</span>published
            </span>
          )}
          {skill.owner_display_name && !isOwner && (
            <span className="text-[10px] text-on-surface-variant/60 font-medium">by {skill.owner_display_name}</span>
          )}
          {skill.has_update && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-600 animate-pulse">
              <span className="material-symbols-outlined text-[10px]">update</span>update
            </span>
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
        {showInstall && onInstall && (
          <button onClick={onInstall} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">add_circle</span>Install
          </button>
        )}
        {isOwner && onShare && (
          <button onClick={onShare} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm">share</span>
          </button>
        )}
        {isOwner && onPublish && (
          <button onClick={() => onPublish(!skill.is_published)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${skill.is_published ? "text-emerald-600 hover:bg-emerald-50" : "text-on-surface-variant hover:text-primary hover:bg-primary/5"}`}>
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: skill.is_published ? "'FILL' 1" : "'FILL' 0" }}>
              {skill.is_published ? "public" : "public_off"}
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
  const [activeTab, setActiveTab] = useState<"marketplace" | "shared" | "library">("library");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Data
  const [mySkills, setMySkills] = useState<SkillNote[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<SkillNote[]>([]);
  const [sharedSkills, setSharedSkills] = useState<SkillNote[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [editorSkill, setEditorSkill] = useState<SkillNote | null | undefined>(undefined); // undefined = closed, null = new
  const [saving, setSaving] = useState(false);
  const [disclaimerTarget, setDisclaimerTarget] = useState<SkillNote | null>(null);
  const [shareTarget, setShareTarget] = useState<SkillNote | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [skills, marketplace, shared, grps] = await Promise.all([
        apiListSkills().catch(() => []),
        apiGetMarketplace({ search: search || undefined, category: categoryFilter !== "all" ? categoryFilter : undefined }).catch(() => ({ skills: [] })),
        apiGetSharedWithMe().catch(() => []),
        apiListGroups().catch(() => []),
      ]);
      setMySkills(skills);
      setMarketplaceSkills(marketplace.skills || []);
      setSharedSkills(shared);
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
      loadData();
    } catch (err) { console.error("Save error:", err); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this skill note? This cannot be undone.")) return;
    try { await apiDeleteSkill(id); loadData(); } catch (err) { console.error(err); }
  };

  const handlePublish = async (id: string, pub: boolean) => {
    try { await apiPublishSkill(id, pub); loadData(); } catch (err) { console.error(err); }
  };

  const handleInstallConfirmed = async () => {
    if (!disclaimerTarget) return;
    try { await apiInstallSkill(disclaimerTarget.id); setDisclaimerTarget(null); loadData(); }
    catch (err) { console.error(err); setDisclaimerTarget(null); }
  };

  const tabs = [
    { id: "library" as const, label: "My Library", icon: "folder_special" },
    { id: "marketplace" as const, label: "Marketplace", icon: "storefront" },
    { id: "shared" as const, label: "Shared With Me", icon: "group" },
  ];

  const currentSkills = activeTab === "library" ? mySkills :
    activeTab === "marketplace" ? marketplaceSkills : sharedSkills;

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

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-surface-container-high/60 backdrop-blur-sm rounded-2xl p-1.5 mb-6 w-fit">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.id ? "bg-white text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface hover:bg-white/50"
              }`}>
              <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: activeTab === tab.id ? "'FILL' 1" : "'FILL' 0" }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Category filter (marketplace tab) */}
        {activeTab === "marketplace" && (
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
              {activeTab === "marketplace" ? "storefront" : activeTab === "shared" ? "group" : "folder_open"}
            </span>
            <p className="text-on-surface-variant">
              {activeTab === "marketplace" ? "No published skills found" :
                activeTab === "shared" ? "No skills have been shared with you yet" :
                "Your skill library is empty. Create your first skill!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSkills.map(skill => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isOwner={skill.owner_id === user?.id}
                showInstall={activeTab !== "library" && skill.owner_id !== user?.id}
                onInstall={() => setDisclaimerTarget(skill)}
                onEdit={skill.owner_id === user?.id ? () => setEditorSkill(skill) : undefined}
                onDelete={skill.owner_id === user?.id ? () => handleDelete(skill.id) : undefined}
                onPublish={skill.owner_id === user?.id ? (pub) => handlePublish(skill.id, pub) : undefined}
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

      <BottomNav />
    </div>
  );
}
