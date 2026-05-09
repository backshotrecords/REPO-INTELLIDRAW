import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { apiGetRules, apiCreateRule, apiUpdateRule, apiDeleteRule, apiGetSoundConfig, apiUpdateSoundConfig, apiGetCanvasConfig, apiUpdateCanvasConfig, apiGenerateResetLink, apiGetModels, apiAddModel, apiDeleteModel, apiGetOnboardingTutorials, apiCreateOnboardingTutorial, apiUpdateOnboardingTutorial, apiDeleteOnboardingTutorial, apiAdminListUsers, apiAdminDeleteUser, apiAdminBanUser } from "../lib/api";

// ─── Config Module Registry ─────────────────────────────
// Add new config modules here — the sidebar auto-populates from this array.
const CONFIG_MODULES: { key: string; label: string; icon: string }[] = [
  { key: "models", label: "AI Models",           icon: "model_training" },
  { key: "sound",  label: "Sound Effects",       icon: "volume_up" },
  { key: "canvas", label: "Canvas Mechanics",    icon: "zoom_in" },
  { key: "rules",  label: "Sanitization Rules",  icon: "rule" },
  { key: "onboarding", label: "Onboarding Tutorials", icon: "school" },
  { key: "userreset", label: "User Account Reset", icon: "lock_reset" },
  { key: "usermgmt", label: "User Management", icon: "manage_accounts" },
];

const ATTACHABLE_PAGES = [
  { value: "/dashboard", label: "Dashboard" },
  { value: "canvas",     label: "Canvas (any)" },
  { value: "/settings",  label: "Settings" },
  { value: "/skills",    label: "Skills Marketplace" },
  { value: "/guild",     label: "Guild Badges" },
];

interface OnboardingTutorial {
  id: string;
  step_order: number;
  gif_url: string | null;
  gif_file_name: string | null;
  explanation_text: string;
  attached_page: string;
  content_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SoundConfig {
  volume: number;
  enabled: boolean;
  soundUrl: string;
  soundFileName: string | null;
  voiceSoundUrl: string;
  voiceSoundFileName: string | null;
}

interface Rule {
  id: string;
  rule_description: string;
  is_active: boolean;
  created_at: string;
}

interface AIModel {
  id: string;
  model_id: string;
  label: string;
  added_at: string;
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  is_banned: boolean;
  is_global_admin: boolean;
  created_at: string;
  canvas_count: number;
}

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState("");
  const [adding, setAdding] = useState(false);

  // Collapsible sections
  const [expandedSection, setExpandedSection] = useState<string | null>("models");

  // AI Models state
  const [aiModels, setAiModels] = useState<AIModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [newModelId, setNewModelId] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [addingModel, setAddingModel] = useState(false);

  // Sound settings state
  const [soundSettings, setSoundSettings] = useState<SoundConfig>({
    volume: 0.5, enabled: true,
    soundUrl: "/intellidraw-v2.mp3", soundFileName: null,
    voiceSoundUrl: "/intellisend_v2.mp3", voiceSoundFileName: null,
  });
  const [previewPlaying, setPreviewPlaying] = useState<"canvas" | "voice" | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const canvasFileRef = useRef<HTMLInputElement | null>(null);
  const voiceFileRef = useRef<HTMLInputElement | null>(null);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Canvas settings state
  const [maxZoomLevel, setMaxZoomLevel] = useState<number>(16);

  // User reset state
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onboarding tutorials state
  const [obTutorials, setObTutorials] = useState<OnboardingTutorial[]>([]);
  const [obLoading, setObLoading] = useState(true);
  const [obAdding, setObAdding] = useState(false);
  const [obNewText, setObNewText] = useState("");
  const [obNewPage, setObNewPage] = useState("/dashboard");
  const [obNewStep, setObNewStep] = useState(1);
  const [obNewForce, setObNewForce] = useState(true);
  const [obNewGifFile, setObNewGifFile] = useState<File | null>(null);
  const obGifInputRef = useRef<HTMLInputElement | null>(null);
  const [obEditId, setObEditId] = useState<string | null>(null);
  const [obEditText, setObEditText] = useState("");
  const [obEditPage, setObEditPage] = useState("");
  const [obEditStep, setObEditStep] = useState(1);
  const [obEditForce, setObEditForce] = useState(true);
  const [obEditGifFile, setObEditGifFile] = useState<File | null>(null);
  const obEditGifInputRef = useRef<HTMLInputElement | null>(null);
  const [obSaving, setObSaving] = useState(false);

  // User management state
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<number>(0); // 0=none, 1=first confirm, 2=final confirm
  const [deleteTargetUser, setDeleteTargetUser] = useState<AdminUser | null>(null);
  const [banningUserId, setBanningUserId] = useState<string | null>(null);

  // ─── Sidebar active-section tracking ───────────────────
  const [activeSection, setActiveSection] = useState<string>(CONFIG_MODULES[0].key);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const isScrollingRef = useRef(false);

  // Observe which section is currently in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );

    // Observe all registered section elements
    for (const mod of CONFIG_MODULES) {
      const el = sectionRefs.current[mod.key];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const scrollToSection = useCallback((key: string) => {
    const el = sectionRefs.current[key];
    if (!el) return;

    // Also expand the section when clicking sidebar
    setExpandedSection(key);
    setActiveSection(key);

    // Briefly disable observer to prevent flicker
    isScrollingRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { isScrollingRef.current = false; }, 800);
  }, []);

  useEffect(() => {
    if (user && !user.isGlobalAdmin) {
      navigate("/dashboard", { replace: true });
      return;
    }
    loadRules();
    loadSoundConfig();
    loadCanvasConfig();
    loadAiModels();
    loadOnboardingTutorials();
    loadAdminUsers();
  }, [user, navigate]);

  // ─── Data loaders ──────────────────────────────────────

  const loadAiModels = async () => {
    setModelsLoading(true);
    try {
      const data = await apiGetModels();
      setAiModels(data.models || []);
    } catch (err) {
      console.error("Failed to load AI models:", err);
    } finally {
      setModelsLoading(false);
    }
  };

  const loadCanvasConfig = async () => {
    try {
      const data = await apiGetCanvasConfig();
      setMaxZoomLevel(data.maxZoomLevel ?? 16);
    } catch (err) {
      console.error("Failed to load canvas config:", err);
    }
  };

  const loadSoundConfig = async () => {
    try {
      const data = await apiGetSoundConfig();
      setSoundSettings({
        volume: data.volume ?? 0.5,
        enabled: data.enabled ?? true,
        soundUrl: data.soundUrl ?? "/intellidraw-v2.mp3",
        soundFileName: data.soundFileName ?? null,
        voiceSoundUrl: data.voiceSoundUrl ?? "/intellisend_v2.mp3",
        voiceSoundFileName: data.voiceSoundFileName ?? null,
      });
    } catch (err) {
      console.error("Failed to load sound config:", err);
    }
  };

  const loadRules = async () => {
    try {
      setLoading(true);
      const data = await apiGetRules();
      setRules(data);
    } catch (err) {
      console.error("Failed to load rules:", err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Accordion toggle ─────────────────────────────────

  const toggleSection = (key: string) =>
    setExpandedSection((prev) => (prev === key ? null : key));

  // ─── AI Models handlers ───────────────────────────────

  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelId.trim()) return;
    setAddingModel(true);
    try {
      await apiAddModel(newModelId.trim(), newModelLabel.trim() || newModelId.trim());
      setNewModelId("");
      setNewModelLabel("");
      await loadAiModels();
    } catch (err) {
      console.error("Failed to add model:", err);
    } finally {
      setAddingModel(false);
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm("Delete this model for all users?")) return;
    try {
      await apiDeleteModel(id);
      await loadAiModels();
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  // ─── Rules handlers ───────────────────────────────────

  // ─── Onboarding handlers ─────────────────────────────

  const loadOnboardingTutorials = async () => {
    setObLoading(true);
    try {
      const data = await apiGetOnboardingTutorials();
      setObTutorials(data || []);
    } catch (err) {
      console.error("Failed to load onboarding tutorials:", err);
    } finally {
      setObLoading(false);
    }
  };

  const handleCreateOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!obNewText.trim()) return;
    setObAdding(true);
    try {
      await apiCreateOnboardingTutorial({
        gif_file: obNewGifFile || undefined,
        explanation_text: obNewText.trim(),
        attached_page: obNewPage,
        step_order: obNewStep,
        force_existing_users: obNewForce,
      });
      setObNewText("");
      setObNewPage("/dashboard");
      setObNewGifFile(null);
      setObNewForce(true);
      if (obGifInputRef.current) obGifInputRef.current.value = "";
      await loadOnboardingTutorials();
      // Auto-increment step for convenience
      setObNewStep(obTutorials.length + 2);
    } catch (err) {
      console.error("Failed to create onboarding tutorial:", err);
    } finally {
      setObAdding(false);
    }
  };

  const handleStartEditOnboarding = (tutorial: OnboardingTutorial) => {
    setObEditId(tutorial.id);
    setObEditText(tutorial.explanation_text);
    setObEditPage(tutorial.attached_page);
    setObEditStep(tutorial.step_order);
    setObEditForce(true);
    setObEditGifFile(null);
  };

  const handleSaveEditOnboarding = async () => {
    if (!obEditId) return;
    setObSaving(true);
    try {
      await apiUpdateOnboardingTutorial(obEditId, {
        gif_file: obEditGifFile || undefined,
        explanation_text: obEditText,
        attached_page: obEditPage,
        step_order: obEditStep,
        force_existing_users: obEditForce,
      });
      setObEditId(null);
      await loadOnboardingTutorials();
    } catch (err) {
      console.error("Failed to update onboarding tutorial:", err);
    } finally {
      setObSaving(false);
    }
  };

  const handleDeleteOnboarding = async (id: string) => {
    if (!confirm("Delete this onboarding tutorial? Users who have already completed it will not be affected.")) return;
    try {
      await apiDeleteOnboardingTutorial(id);
      await loadOnboardingTutorials();
    } catch (err) {
      console.error("Failed to delete onboarding tutorial:", err);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.trim()) return;
    setAdding(true);
    try {
      const added = await apiCreateRule(newRule.trim());
      setRules([added, ...rules]);
      setNewRule("");
    } catch (err) {
      console.error("Failed to add rule:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleToggleRule = async (id: string, currentActive: boolean) => {
    try {
      setRules(rules.map((r) => (r.id === id ? { ...r, is_active: !currentActive } : r)));
      await apiUpdateRule(id, !currentActive);
    } catch (err) {
      console.error("Failed to toggle rule:", err);
      setRules(rules.map((r) => (r.id === id ? { ...r, is_active: currentActive } : r)));
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    try {
      await apiDeleteRule(id);
      setRules(rules.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete rule:", err);
    }
  };

  // ─── Sound Settings Handlers ──────────────────────────

  const applyConfigResponse = (data: Record<string, unknown>) => {
    setSoundSettings({
      volume: (data.volume as number) ?? 0.5,
      enabled: (data.enabled as boolean) ?? true,
      soundUrl: (data.soundUrl as string) ?? "/intellidraw-v2.mp3",
      soundFileName: (data.soundFileName as string) ?? null,
      voiceSoundUrl: (data.voiceSoundUrl as string) ?? "/intellisend_v2.mp3",
      voiceSoundFileName: (data.voiceSoundFileName as string) ?? null,
    });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    setSoundSettings((prev) => ({ ...prev, volume }));
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    volumeDebounceRef.current = setTimeout(async () => {
      try { await apiUpdateSoundConfig({ volume }); } catch (err) { console.error("Failed to save volume:", err); }
    }, 400);
  };

  const handleToggleSound = async () => {
    const newEnabled = !soundSettings.enabled;
    setSoundSettings((prev) => ({ ...prev, enabled: newEnabled }));
    try {
      await apiUpdateSoundConfig({ enabled: newEnabled });
    } catch {
      setSoundSettings((prev) => ({ ...prev, enabled: !newEnabled }));
    }
  };

  const handleMaxZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMaxZoomLevel(val);
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(async () => {
      try { await apiUpdateCanvasConfig({ maxZoomLevel: val }); } catch (err) { console.error("Failed to save max zoom:", err); }
    }, 400);
  };

  const handlePreview = (type: "canvas" | "voice") => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    const url = type === "voice" ? soundSettings.voiceSoundUrl : soundSettings.soundUrl;
    const audio = new Audio(url);
    audio.volume = soundSettings.volume;
    previewAudioRef.current = audio;
    setPreviewPlaying(type);
    audio.play().catch(() => {});
    audio.onended = () => setPreviewPlaying(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "canvas" | "voice") => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await apiUpdateSoundConfig({ soundFile: file, soundType: type });
      applyConfigResponse(data);
    } catch (err) {
      console.error(`Failed to upload ${type} sound:`, err);
    }
    e.target.value = "";
  };

  const handleReset = async (type: "canvas" | "voice") => {
    try {
      const data = await apiUpdateSoundConfig({ resetToDefault: true, soundType: type });
      applyConfigResponse(data);
    } catch (err) {
      console.error(`Failed to reset ${type} sound:`, err);
    }
  };

  const isCanvasCustom = soundSettings.soundUrl !== "/intellidraw-v2.mp3";
  const isVoiceCustom = soundSettings.voiceSoundUrl !== "/intellisend_v2.mp3";

  // ─── User Management Handlers ─────────────────────────

  const loadAdminUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await apiAdminListUsers();
      setAdminUsers(data || []);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setUsersLoading(false);
    }
  };

  const handleBanUser = async (userId: string, ban: boolean) => {
    setBanningUserId(userId);
    try {
      await apiAdminBanUser(userId, ban);
      setAdminUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_banned: ban } : u))
      );
    } catch (err) {
      console.error("Failed to ban/unban user:", err);
    } finally {
      setBanningUserId(null);
    }
  };

  const handleStartDelete = (u: AdminUser) => {
    setDeleteTargetUser(u);
    setDeleteConfirmStep(1);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetUser) return;
    if (deleteConfirmStep === 1) {
      setDeleteConfirmStep(2);
      return;
    }
    // Final delete
    setDeletingUserId(deleteTargetUser.id);
    try {
      await apiAdminDeleteUser(deleteTargetUser.id);
      setAdminUsers((prev) => prev.filter((u) => u.id !== deleteTargetUser.id));
      setDeleteConfirmStep(0);
      setDeleteTargetUser(null);
    } catch (err) {
      console.error("Failed to delete user:", err);
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmStep(0);
    setDeleteTargetUser(null);
  };

  const filteredUsers = adminUsers.filter((u) => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.display_name.toLowerCase().includes(q)
    );
  });

  // ─── User Reset Handler ───────────────────────────────

  const handleGenerateResetLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetting(true);
    setGeneratedLink(null);
    setResetError(null);
    setLinkCopied(false);
    try {
      const data = await apiGenerateResetLink(resetEmail.trim());
      const fullLink = `${window.location.origin}${data.resetLink}`;
      setGeneratedLink(fullLink);
      setResetEmail("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Failed to generate reset link");
    } finally {
      setResetting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback: select the text
    }
  };

  // ─── Sound card sub-component (used for both canvas & voice) ──

  const renderSoundCard = (opts: {
    type: "canvas" | "voice";
    label: string;
    description: string;
    icon: string;
    currentUrl: string;
    fileName: string | null;
    defaultLabel: string;
    isCustom: boolean;
    fileRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-lg text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>{opts.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-on-surface">{opts.label}</p>
          <p className="text-[11px] text-on-surface-variant">{opts.description}</p>
        </div>
      </div>

      {/* Current file */}
      <div className="flex items-center gap-2 bg-white border border-outline-variant/10 rounded-lg px-3 py-2">
        <span className="material-symbols-outlined text-sm text-on-surface-variant" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
        <span className="text-xs font-medium text-on-surface truncate flex-1">
          {opts.isCustom ? (opts.fileName || "Custom Sound") : opts.defaultLabel}
        </span>
        {opts.isCustom && (
          <span className="text-[10px] font-bold uppercase tracking-wide bg-secondary-fixed text-on-secondary-fixed-variant px-1.5 py-0.5 rounded">Custom</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => handlePreview(opts.type)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-secondary-fixed text-on-secondary-fixed-variant text-xs font-bold rounded-lg hover:bg-secondary-fixed-dim transition-colors active:scale-95"
        >
          <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
            {previewPlaying === opts.type ? "stop_circle" : "play_circle"}
          </span>
          {previewPlaying === opts.type ? "Playing..." : "Preview"}
        </button>

        <button
          onClick={() => opts.fileRef.current?.click()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-container-high text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors active:scale-95"
        >
          <span className="material-symbols-outlined text-sm">upload_file</span>
          Replace
        </button>
        <input
          ref={opts.fileRef}
          type="file"
          className="hidden"
          accept="audio/*"
          onChange={(e) => handleFileUpload(e, opts.type)}
        />

        {opts.isCustom && (
          <button
            onClick={() => handleReset(opts.type)}
            className="inline-flex items-center justify-center p-2 text-on-surface-variant rounded-lg border border-outline-variant/20 hover:bg-surface-container-high transition-colors active:scale-95"
            title="Reset to default"
          >
            <span className="material-symbols-outlined text-sm">restart_alt</span>
          </button>
        )}
      </div>
    </div>
  );

  // ─── Accordion header sub-component ───────────────────

  const renderAccordionHeader = (key: string, icon: string, title: string, subtitle: string) => (
    <button
      onClick={() => toggleSection(key)}
      className="w-full flex items-center justify-between p-5 group"
    >
      <div className="flex items-center gap-3">
        <span
          className="material-symbols-outlined text-2xl text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
        <div className="text-left">
          <h2 className="text-lg font-semibold tracking-tight text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-variant">{subtitle}</p>
        </div>
      </div>
      <span
        className={`material-symbols-outlined text-on-surface-variant transition-transform duration-300 ${
          expandedSection === key ? "rotate-180" : ""
        }`}
      >
        expand_more
      </span>
    </button>
  );

  return (
    <div className="bg-surface min-h-screen text-on-surface font-body">
      {/* ─── Top header bar ────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-lg border-b border-outline-variant/20">
        <div className="max-w-7xl mx-auto flex items-center gap-4 px-6 py-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="material-symbols-outlined p-2 rounded-full hover:bg-surface-container transition-colors"
          >
            arrow_back
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-manrope tracking-tight text-primary">Global Admin Dashboard</h1>
            <p className="text-xs text-on-surface-variant hidden sm:block">Configure global sound effects and sanitization rules</p>
          </div>
        </div>
      </header>

      {/* ─── Two-column layout: sidebar + content ─────────── */}
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row">

        {/* ── Sidebar ──────────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-[73px] self-start h-[calc(100vh-73px)] border-r border-outline-variant/15 py-6 px-4 gap-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50 px-3 mb-2">
            Configuration
          </p>
          {CONFIG_MODULES.map((mod) => {
            const isActive = activeSection === mod.key;
            return (
              <button
                key={mod.key}
                onClick={() => scrollToSection(mod.key)}
                className={`
                  group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left text-sm font-medium
                  transition-all duration-200 relative
                  ${isActive
                    ? "bg-primary/8 text-primary font-semibold"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }
                `}
              >
                {/* Active indicator bar */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-full transition-all duration-300 ${
                    isActive ? "h-5 bg-primary" : "h-0 bg-transparent"
                  }`}
                />
                <span
                  className={`material-symbols-outlined text-lg transition-colors duration-200 ${
                    isActive ? "text-primary" : "text-on-surface-variant/60 group-hover:text-on-surface-variant"
                  }`}
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {mod.icon}
                </span>
                {mod.label}
              </button>
            );
          })}

          {/* Bottom spacer + decorative divider */}
          <div className="mt-auto border-t border-outline-variant/10 pt-4 px-3">
            <p className="text-[11px] text-on-surface-variant/40 leading-relaxed">
              {CONFIG_MODULES.length} module{CONFIG_MODULES.length !== 1 ? "s" : ""} configured
            </p>
          </div>
        </aside>

        {/* ── Mobile sidebar (horizontal scroll strip) ────── */}
        <div className="lg:hidden sticky top-[73px] z-20 bg-surface/90 backdrop-blur-md border-b border-outline-variant/15 w-full">
          <div className="flex gap-1 px-4 py-2 overflow-x-auto no-scrollbar">
            {CONFIG_MODULES.map((mod) => {
              const isActive = activeSection === mod.key;
              return (
                <button
                  key={mod.key}
                  onClick={() => scrollToSection(mod.key)}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap
                    transition-all duration-200
                    ${isActive
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high"
                    }
                  `}
                >
                  <span
                    className="material-symbols-outlined text-base"
                    style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {mod.icon}
                  </span>
                  {mod.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────── */}
        <main className="flex-1 min-w-0 px-6 py-6 space-y-6">

          {/* ═══ AI Models (collapsible) ════════════════════════ */}
          <section
            id="models"
            ref={(el) => { sectionRefs.current["models"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("models", "model_training", "AI Models", `${aiModels.length} model${aiModels.length !== 1 ? "s" : ""} available to all users`)}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "models" ? "2000px" : "0",
                opacity: expandedSection === "models" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/10">
                {/* Add model form */}
                <form onSubmit={handleAddModel} className="flex flex-col sm:flex-row gap-3 pt-4">
                  <input
                    type="text"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    placeholder="Model ID (e.g. gpt-4o)"
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm font-mono"
                    disabled={addingModel}
                  />
                  <input
                    type="text"
                    value={newModelLabel}
                    onChange={(e) => setNewModelLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    disabled={addingModel}
                  />
                  <button
                    type="submit"
                    disabled={addingModel || !newModelId.trim()}
                    className="bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    {addingModel ? "Adding..." : "Add Model"}
                  </button>
                </form>

                {/* Models list */}
                {modelsLoading ? (
                  <div className="flex justify-center p-12">
                    <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
                  </div>
                ) : aiModels.length === 0 ? (
                  <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border border-outline-variant/20 border-dashed">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">model_training</span>
                    <p className="text-on-surface-variant font-medium">No models configured yet.</p>
                    <p className="text-sm text-on-surface-variant/60">Add a model above to make it available in everyone's model picker.</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {aiModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center justify-between p-4 rounded-xl bg-white border border-outline-variant/30 shadow-sm transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary text-base" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-on-surface font-mono">{model.model_id}</p>
                            {model.label && model.label !== model.model_id && (
                              <p className="text-xs text-on-surface-variant">{model.label}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteModel(model.id)}
                          className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded-lg transition-colors"
                          title="Delete model"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ═══ Sound Effects (collapsible) ═══════════════════ */}
          <section
            id="sound"
            ref={(el) => { sectionRefs.current["sound"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("sound", "volume_up", "Sound Effects", "Notification sounds for canvas updates and voice transcription")}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "sound" ? "1000px" : "0",
                opacity: expandedSection === "sound" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-6 border-t border-outline-variant/10">
                {/* Global controls row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-4">
                  {/* Enable / disable toggle */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleToggleSound}
                      className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                        soundSettings.enabled ? "bg-primary" : "bg-outline-variant/40"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                          soundSettings.enabled ? "translate-x-5" : ""
                        }`}
                      />
                    </button>
                    <span className="text-sm font-medium text-on-surface">
                      {soundSettings.enabled ? "Sounds Enabled" : "Sounds Disabled"}
                    </span>
                  </div>

                  {/* Volume slider */}
                  <div className={`flex-1 flex items-center gap-3 transition-opacity duration-200 ${soundSettings.enabled ? "opacity-100" : "opacity-30 pointer-events-none"}`}>
                    <span className="material-symbols-outlined text-base text-on-surface-variant/50">volume_mute</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={soundSettings.volume}
                      onChange={handleVolumeChange}
                      className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-primary"
                      style={{
                        background: `linear-gradient(to right, var(--md-sys-color-primary, #6750A4) 0%, var(--md-sys-color-primary, #6750A4) ${soundSettings.volume * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) ${soundSettings.volume * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) 100%)`,
                      }}
                    />
                    <span className="material-symbols-outlined text-base text-on-surface-variant/50">volume_up</span>
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full min-w-[3rem] text-center">
                      {Math.round(soundSettings.volume * 100)}%
                    </span>
                  </div>
                </div>

                {/* Individual sound cards */}
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${soundSettings.enabled ? "opacity-100" : "opacity-30 pointer-events-none"}`}>
                  {renderSoundCard({
                    type: "canvas",
                    label: "Canvas Update",
                    description: "Plays when AI updates the flowchart",
                    icon: "auto_awesome",
                    currentUrl: soundSettings.soundUrl,
                    fileName: soundSettings.soundFileName,
                    defaultLabel: "IntelliDraw v2 (Default)",
                    isCustom: isCanvasCustom,
                    fileRef: canvasFileRef,
                  })}
                  {renderSoundCard({
                    type: "voice",
                    label: "Voice Transcription",
                    description: "Plays when transcribed text returns",
                    icon: "mic",
                    currentUrl: soundSettings.voiceSoundUrl,
                    fileName: soundSettings.voiceSoundFileName,
                    defaultLabel: "IntelliSend v2 (Default)",
                    isCustom: isVoiceCustom,
                    fileRef: voiceFileRef,
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ═══ Canvas Mechanics (collapsible) ═══════════════════ */}
          <section
            id="canvas"
            ref={(el) => { sectionRefs.current["canvas"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("canvas", "zoom_in", "Canvas Mechanics", "Configure global constraints for the flowchart rendering surface")}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "canvas" ? "500px" : "0",
                opacity: expandedSection === "canvas" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-6 border-t border-outline-variant/10">
                <div className="flex flex-col gap-2 pt-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-semibold text-on-surface">Maximum Zoom Level</label>
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      {Math.round(maxZoomLevel * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">
                    Caps how far users can zoom into the canvas. Increase this if flowcharts contain tiny, dense details.
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs font-medium text-on-surface-variant/60">100%</span>
                    <input
                      type="range"
                      min="1"
                      max="200"
                      step="1"
                      value={maxZoomLevel}
                      onChange={handleMaxZoomChange}
                      className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-primary"
                      style={{
                        background: `linear-gradient(to right, var(--md-sys-color-primary, #6750A4) 0%, var(--md-sys-color-primary, #6750A4) ${((maxZoomLevel - 1) / 199) * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) ${((maxZoomLevel - 1) / 199) * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) 100%)`,
                      }}
                    />
                    <span className="text-xs font-medium text-on-surface-variant/60">20000%</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ═══ Sanitization Rules (collapsible) ════════════════ */}
          <section
            id="rules"
            ref={(el) => { sectionRefs.current["rules"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("rules", "rule", "Sanitization Rules", `${rules.length} rule${rules.length !== 1 ? "s" : ""} — enforced during Auto-Fix`)}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "rules" ? "2000px" : "0",
                opacity: expandedSection === "rules" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/10">
                {/* Add rule form */}
                <form onSubmit={handleAddRule} className="flex gap-3 pt-4">
                  <input
                    type="text"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    placeholder="e.g. Ensure all parentheses in node labels are replaced with text"
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    disabled={adding}
                  />
                  <button
                    type="submit"
                    disabled={adding || !newRule.trim()}
                    className="bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    {adding ? "Adding..." : "Add Rule"}
                  </button>
                </form>

                {/* Rules list */}
                {loading ? (
                  <div className="flex justify-center p-12">
                    <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
                  </div>
                ) : rules.length === 0 ? (
                  <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border border-outline-variant/20 border-dashed">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">rule</span>
                    <p className="text-on-surface-variant font-medium">No rules defined yet.</p>
                    <p className="text-sm text-on-surface-variant/60">Add a rule above to enforce conditions during Auto-Fix.</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {rules.map((rule) => (
                      <div
                        key={rule.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                          rule.is_active
                            ? "bg-white border-outline-variant/30 shadow-sm"
                            : "bg-surface-container-lowest border-outline-variant/20 opacity-70"
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => handleToggleRule(rule.id, rule.is_active)}
                            className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors ${
                              rule.is_active
                                ? "bg-primary border-primary text-white"
                                : "bg-transparent border-on-surface-variant/30 text-transparent"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                          </button>
                          <span className={`text-sm font-medium ${!rule.is_active && "line-through text-on-surface-variant"}`}>
                            {rule.rule_description}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded-lg transition-colors"
                          title="Delete rule"
                        >
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
          {/* ═══ Onboarding Tutorials (collapsible) ══════════════ */}
          <section
            id="onboarding"
            ref={(el) => { sectionRefs.current["onboarding"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("onboarding", "school", "Onboarding Tutorials", `${obTutorials.length} tutorial${obTutorials.length !== 1 ? "s" : ""} in the global sequence`)}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "onboarding" ? "4000px" : "0",
                opacity: expandedSection === "onboarding" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-5 border-t border-outline-variant/10">
                {/* Create form */}
                <form onSubmit={handleCreateOnboarding} className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Step order */}
                    <div>
                      <label className="text-xs font-semibold text-on-surface-variant block mb-1.5">Step Order</label>
                      <input
                        type="number"
                        min={1}
                        value={obNewStep}
                        onChange={(e) => setObNewStep(Number(e.target.value))}
                        className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                      />
                    </div>
                    {/* Attached page */}
                    <div>
                      <label className="text-xs font-semibold text-on-surface-variant block mb-1.5">Attached Page</label>
                      <select
                        value={obNewPage}
                        onChange={(e) => setObNewPage(e.target.value)}
                        className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                      >
                        {ATTACHABLE_PAGES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Explanation text */}
                  <div>
                    <label className="text-xs font-semibold text-on-surface-variant block mb-1.5">Explanation Text</label>
                    <textarea
                      value={obNewText}
                      onChange={(e) => setObNewText(e.target.value)}
                      placeholder="Explain what this tutorial teaches the user..."
                      rows={3}
                      className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm resize-none"
                      disabled={obAdding}
                    />
                  </div>

                  {/* GIF upload + force toggle + submit */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      <button
                        type="button"
                        onClick={() => obGifInputRef.current?.click()}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface-container-high text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors active:scale-95"
                      >
                        <span className="material-symbols-outlined text-sm">gif_box</span>
                        {obNewGifFile ? obNewGifFile.name : "Upload GIF"}
                      </button>
                      <input
                        ref={obGifInputRef}
                        type="file"
                        className="hidden"
                        accept="image/gif,image/*"
                        onChange={(e) => setObNewGifFile(e.target.files?.[0] || null)}
                      />

                      {/* Force toggle */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <button
                          type="button"
                          onClick={() => setObNewForce(!obNewForce)}
                          className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${obNewForce ? "bg-primary" : "bg-outline-variant/40"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${obNewForce ? "translate-x-4" : ""}`} />
                        </button>
                        <span className="text-xs font-medium text-on-surface-variant">Force existing users</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={obAdding || !obNewText.trim()}
                      className="bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2 active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                      {obAdding ? "Creating..." : "Create Tutorial"}
                    </button>
                  </div>
                </form>

                {/* Tutorial list */}
                {obLoading ? (
                  <div className="flex justify-center p-12">
                    <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
                  </div>
                ) : obTutorials.length === 0 ? (
                  <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border border-outline-variant/20 border-dashed">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">school</span>
                    <p className="text-on-surface-variant font-medium">No onboarding tutorials yet.</p>
                    <p className="text-sm text-on-surface-variant/60">Create one above to start building the onboarding sequence.</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {obTutorials.map((tutorial) => (
                      <div
                        key={tutorial.id}
                        className="bg-white border border-outline-variant/30 rounded-xl shadow-sm overflow-hidden"
                      >
                        {obEditId === tutorial.id ? (
                          /* ── Edit mode ──────────────────────── */
                          <div className="p-4 space-y-3 bg-primary/5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[11px] font-semibold text-on-surface-variant block mb-1">Step Order</label>
                                <input
                                  type="number"
                                  min={1}
                                  value={obEditStep}
                                  onChange={(e) => setObEditStep(Number(e.target.value))}
                                  className="w-full bg-white border border-outline-variant/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-semibold text-on-surface-variant block mb-1">Attached Page</label>
                                <select
                                  value={obEditPage}
                                  onChange={(e) => setObEditPage(e.target.value)}
                                  className="w-full bg-white border border-outline-variant/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                                >
                                  {ATTACHABLE_PAGES.map((p) => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <textarea
                              value={obEditText}
                              onChange={(e) => setObEditText(e.target.value)}
                              rows={3}
                              className="w-full bg-white border border-outline-variant/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                            />
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => obEditGifInputRef.current?.click()}
                                className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-container-high text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container-highest transition-colors"
                              >
                                <span className="material-symbols-outlined text-sm">gif_box</span>
                                {obEditGifFile ? obEditGifFile.name : "Replace GIF"}
                              </button>
                              <input
                                ref={obEditGifInputRef}
                                type="file"
                                className="hidden"
                                accept="image/gif,image/*"
                                onChange={(e) => setObEditGifFile(e.target.files?.[0] || null)}
                              />
                              <label className="flex items-center gap-2 cursor-pointer">
                                <button
                                  type="button"
                                  onClick={() => setObEditForce(!obEditForce)}
                                  className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${obEditForce ? "bg-primary" : "bg-outline-variant/40"}`}
                                >
                                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${obEditForce ? "translate-x-4" : ""}`} />
                                </button>
                                <span className="text-xs text-on-surface-variant">Force</span>
                              </label>
                              <div className="flex-1" />
                              <button
                                onClick={() => setObEditId(null)}
                                className="text-xs font-bold text-on-surface-variant hover:text-on-surface px-3 py-2"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveEditOnboarding}
                                disabled={obSaving || !obEditText.trim()}
                                className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors active:scale-95"
                              >
                                {obSaving ? "Saving..." : "Save Changes"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── View mode ──────────────────────── */
                          <div className="flex items-start gap-4 p-4">
                            {/* Step number badge */}
                            <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                              <span className="text-sm font-bold text-primary">{tutorial.step_order}</span>
                            </div>

                            {/* GIF thumbnail */}
                            {tutorial.gif_url && (
                              <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-surface-container-high border border-outline-variant/20">
                                <img src={tutorial.gif_url} alt="" className="w-full h-full object-cover" />
                              </div>
                            )}

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-on-surface line-clamp-2">{tutorial.explanation_text}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-secondary-fixed text-on-secondary-fixed-variant px-1.5 py-0.5 rounded">
                                  {ATTACHABLE_PAGES.find((p) => p.value === tutorial.attached_page)?.label || tutorial.attached_page}
                                </span>
                                {tutorial.content_updated_at && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                    Content Updated
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleStartEditOnboarding(tutorial)}
                                className="p-2 text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                                title="Edit tutorial"
                              >
                                <span className="material-symbols-outlined text-[20px]">edit</span>
                              </button>
                              <button
                                onClick={() => handleDeleteOnboarding(tutorial.id)}
                                className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded-lg transition-colors"
                                title="Delete tutorial"
                              >
                                <span className="material-symbols-outlined text-[20px]">delete</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ═══ User Account Reset (collapsible) ════════════════ */}
          <section
            id="userreset"
            ref={(el) => { sectionRefs.current["userreset"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("userreset", "lock_reset", "User Account Reset", "Generate a password reset link for any user")}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "userreset" ? "600px" : "0",
                opacity: expandedSection === "userreset" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/10">
                {/* Description */}
                <div className="flex items-start gap-3 pt-4">
                  <span className="material-symbols-outlined text-lg text-amber-500 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Enter a user's email to generate a one-time reset link. When the link is visited, the user's password will be set to: <span className="font-bold text-on-surface font-mono bg-surface-container-high px-1.5 py-0.5 rounded">password</span>
                  </p>
                </div>

                {/* Email input + button */}
                <form onSubmit={handleGenerateResetLink} className="flex gap-3">
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(e) => { setResetEmail(e.target.value); setResetError(null); }}
                    placeholder="user@example.com"
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    disabled={resetting}
                    required
                  />
                  <button
                    type="submit"
                    disabled={resetting || !resetEmail.trim()}
                    className="bg-error text-white font-semibold px-6 py-3 rounded-xl hover:bg-error/90 disabled:opacity-50 transition-colors flex items-center gap-2 active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">lock_reset</span>
                    {resetting ? "Generating..." : "Generate Reset Link"}
                  </button>
                </form>

                {/* Error feedback */}
                {resetError && (
                  <div className="flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-xl px-4 py-3">
                    <span className="material-symbols-outlined text-sm text-error" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                    <p className="text-sm text-error font-medium">{resetError}</p>
                  </div>
                )}

                {/* Generated link display */}
                {generatedLink && (
                  <div className="bg-surface-container-lowest border border-green-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      <p className="text-sm font-semibold text-green-700">Reset link generated successfully</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={generatedLink}
                        readOnly
                        className="flex-1 bg-white border border-outline-variant/30 rounded-lg px-3 py-2 text-xs font-mono text-on-surface-variant select-all outline-none"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        onClick={handleCopyLink}
                        className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all active:scale-95 ${
                          linkCopied
                            ? "bg-green-100 text-green-700 border border-green-200"
                            : "bg-primary text-white hover:bg-primary/90"
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">
                          {linkCopied ? "done" : "content_copy"}
                        </span>
                        {linkCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-[11px] text-on-surface-variant/60">
                      This link is single-use. Once visited, it will expire and cannot be reused.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ═══ User Management (collapsible) ═══════════════════ */}
          <section
            id="usermgmt"
            ref={(el) => { sectionRefs.current["usermgmt"] = el; }}
            className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden scroll-mt-24"
          >
            {renderAccordionHeader("usermgmt", "manage_accounts", "User Management", `${adminUsers.length} registered user${adminUsers.length !== 1 ? "s" : ""}`)}

            <div
              className="transition-all duration-300 ease-in-out overflow-hidden"
              style={{
                maxHeight: expandedSection === "usermgmt" ? "4000px" : "0",
                opacity: expandedSection === "usermgmt" ? 1 : 0,
              }}
            >
              <div className="px-5 pb-5 space-y-4 border-t border-outline-variant/10">
                {/* Search bar */}
                <div className="pt-4">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search by name or email..."
                      className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-xl pl-10 pr-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
                    />
                    {userSearch && (
                      <button
                        onClick={() => setUserSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface-variant"
                      >
                        <span className="material-symbols-outlined text-lg">close</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* User list */}
                {usersLoading ? (
                  <div className="flex justify-center p-12">
                    <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border border-outline-variant/20 border-dashed">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">person_off</span>
                    <p className="text-on-surface-variant font-medium">
                      {userSearch ? "No users match your search." : "No users found."}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {filteredUsers.map((u) => {
                      const isSelf = u.id === user?.id;
                      const isBanning = banningUserId === u.id;
                      const isDeleting = deletingUserId === u.id;

                      return (
                        <div
                          key={u.id}
                          className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                            u.is_banned
                              ? "bg-error-container/10 border-error/20"
                              : "bg-white border-outline-variant/30"
                          } ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
                        >
                          {/* Avatar */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            u.is_banned
                              ? "bg-error/10"
                              : u.is_global_admin
                                ? "bg-primary/10"
                                : "bg-surface-container-high"
                          }`}>
                            <span
                              className={`material-symbols-outlined text-lg ${
                                u.is_banned
                                  ? "text-error"
                                  : u.is_global_admin
                                    ? "text-primary"
                                    : "text-on-surface-variant"
                              }`}
                              style={{ fontVariationSettings: "'FILL' 1" }}
                            >
                              {u.is_banned ? "block" : u.is_global_admin ? "shield_person" : "person"}
                            </span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-on-surface truncate">{u.display_name}</p>
                              {u.is_global_admin && (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                  Admin
                                </span>
                              )}
                              {u.is_banned && (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-error/10 text-error px-1.5 py-0.5 rounded">
                                  Banned
                                </span>
                              )}
                              {isSelf && (
                                <span className="text-[10px] font-bold uppercase tracking-wide bg-secondary-fixed text-on-secondary-fixed-variant px-1.5 py-0.5 rounded">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[11px] text-on-surface-variant/60">
                                {u.canvas_count} canvas{u.canvas_count !== 1 ? "es" : ""}
                              </span>
                              <span className="text-[11px] text-on-surface-variant/40">•</span>
                              <span className="text-[11px] text-on-surface-variant/60">
                                Joined {new Date(u.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Ban/Unban */}
                            <button
                              onClick={() => {
                                if (!u.is_banned) {
                                  if (!confirm(`Ban ${u.display_name} (${u.email})? They will be unable to log in.`)) return;
                                }
                                handleBanUser(u.id, !u.is_banned);
                              }}
                              disabled={isSelf || isBanning}
                              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                                u.is_banned
                                  ? "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                              }`}
                              title={isSelf ? "Cannot modify your own account" : u.is_banned ? "Unban user" : "Ban user"}
                            >
                              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                                {isBanning ? "progress_activity" : u.is_banned ? "check_circle" : "block"}
                              </span>
                              {isBanning ? "..." : u.is_banned ? "Unban" : "Ban"}
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleStartDelete(u)}
                              disabled={isSelf || isDeleting}
                              className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              title={isSelf ? "Cannot delete your own account" : "Delete user and all data"}
                            >
                              <span className="material-symbols-outlined text-[20px]">
                                {isDeleting ? "progress_activity" : "delete_forever"}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ═══ Delete Confirmation Modal ═══════════════════════ */}
          {deleteConfirmStep > 0 && deleteTargetUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95">
                {/* Header */}
                <div className="p-5 bg-error/5 border-b border-error/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-error text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {deleteConfirmStep === 1 ? "warning" : "delete_forever"}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-on-surface">
                        {deleteConfirmStep === 1 ? "Delete User Account?" : "Final Confirmation"}
                      </h3>
                      <p className="text-xs text-on-surface-variant">{deleteTargetUser.email}</p>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="p-5 space-y-3">
                  {deleteConfirmStep === 1 ? (
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      This will <span className="font-bold text-error">permanently delete</span> the account for <span className="font-bold text-on-surface">{deleteTargetUser.display_name}</span> and all associated data:
                    </p>
                  ) : (
                    <div className="bg-error/5 border border-error/20 rounded-xl p-4">
                      <p className="text-sm font-bold text-error">⚠ This action is irreversible.</p>
                      <p className="text-sm text-on-surface-variant mt-1">
                        Are you absolutely sure you want to permanently destroy all data for <span className="font-bold">{deleteTargetUser.email}</span>?
                      </p>
                    </div>
                  )}

                  {deleteConfirmStep === 1 && (
                    <ul className="text-sm text-on-surface-variant space-y-1.5 ml-1">
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">dashboard</span>
                        All canvases ({deleteTargetUser.canvas_count})
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">auto_fix_high</span>
                        All skills, shares, and attachments
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">history</span>
                        All canvas commit history
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">group</span>
                        All owned groups and memberships
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">settings</span>
                        API keys and account settings
                      </li>
                    </ul>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-5 border-t border-outline-variant/10 bg-surface-container-lowest/50">
                  <button
                    onClick={handleCancelDelete}
                    className="px-4 py-2.5 text-sm font-bold text-on-surface-variant hover:text-on-surface rounded-xl hover:bg-surface-container-high transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={!!deletingUserId}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 ${
                      deleteConfirmStep === 2
                        ? "bg-error text-white hover:bg-error/90"
                        : "bg-error/10 text-error hover:bg-error/20 border border-error/30"
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {deletingUserId ? "progress_activity" : deleteConfirmStep === 2 ? "delete_forever" : "arrow_forward"}
                    </span>
                    {deletingUserId
                      ? "Deleting..."
                      : deleteConfirmStep === 2
                        ? "Delete Permanently"
                        : "Continue"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
