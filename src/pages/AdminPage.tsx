import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { apiGetRules, apiCreateRule, apiUpdateRule, apiDeleteRule, apiGetSoundConfig, apiUpdateSoundConfig } from "../lib/api";

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

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState("");
  const [adding, setAdding] = useState(false);

  // Collapsible sections
  const [expandedSection, setExpandedSection] = useState<string | null>("sound");

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

  useEffect(() => {
    if (user && !user.isGlobalAdmin) {
      navigate("/dashboard", { replace: true });
      return;
    }
    loadRules();
    loadSoundConfig();
  }, [user, navigate]);

  // ─── Data loaders ──────────────────────────────────────

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

  // ─── Rules handlers ───────────────────────────────────

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
      try { await apiUpdateSoundConfig({ volume }); } catch { /* silent */ }
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
    <div className="bg-surface min-h-screen text-on-surface font-body p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="flex items-center gap-4 border-b border-outline-variant/30 pb-6">
          <button
            onClick={() => navigate("/dashboard")}
            className="material-symbols-outlined p-2 rounded-full hover:bg-surface-container transition-colors"
          >
            arrow_back
          </button>
          <div>
            <h1 className="text-2xl font-bold font-manrope tracking-tight text-primary">Global Admin Dashboard</h1>
            <p className="text-sm text-on-surface-variant">Configure global sound effects and sanitization rules</p>
          </div>
        </header>

        {/* ═══ Sound Effects (collapsible) ═══════════════════ */}
        <section className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden">
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

        {/* ═══ Sanitization Rules (collapsible) ════════════════ */}
        <section className="bg-white rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden">
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
      </div>
    </div>
  );
}
