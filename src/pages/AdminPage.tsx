import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { apiGetRules, apiCreateRule, apiUpdateRule, apiDeleteRule, apiGetSoundConfig, apiUpdateSoundConfig } from "../lib/api";

interface SoundConfig {
  volume: number;
  enabled: boolean;
  soundUrl: string;
  soundFileName: string | null;
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

  // Sound settings state
  const [soundSettings, setSoundSettings] = useState<SoundConfig>({
    volume: 0.5, enabled: true, soundUrl: "/intellidraw-v2.mp3", soundFileName: null,
  });
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Redirect if not an admin
    if (user && !user.isGlobalAdmin) {
      navigate("/dashboard", { replace: true });
      return;
    }

    loadRules();
    loadSoundConfig();
  }, [user, navigate]);

  const loadSoundConfig = async () => {
    try {
      const data = await apiGetSoundConfig();
      setSoundSettings({
        volume: data.volume ?? 0.5,
        enabled: data.enabled ?? true,
        soundUrl: data.soundUrl ?? "/intellidraw-v2.mp3",
        soundFileName: data.soundFileName ?? null,
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
      // Revert optimistic update
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

  // ─── Sound Settings Handlers ───────────────────────────

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    // Optimistic local update
    setSoundSettings((prev) => ({ ...prev, volume }));
    // Debounce the server call so dragging the slider doesn't spam
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    volumeDebounceRef.current = setTimeout(async () => {
      try {
        await apiUpdateSoundConfig({ volume });
      } catch (err) {
        console.error("Failed to update volume:", err);
      }
    }, 400);
  };

  const handleToggleSound = async () => {
    const newEnabled = !soundSettings.enabled;
    setSoundSettings((prev) => ({ ...prev, enabled: newEnabled }));
    try {
      await apiUpdateSoundConfig({ enabled: newEnabled });
    } catch (err) {
      console.error("Failed to toggle sound:", err);
      setSoundSettings((prev) => ({ ...prev, enabled: !newEnabled }));
    }
  };

  const handlePreviewSound = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    const audio = new Audio(soundSettings.soundUrl);
    audio.volume = soundSettings.volume;
    previewAudioRef.current = audio;
    setPreviewPlaying(true);
    audio.play().catch(() => {});
    audio.onended = () => setPreviewPlaying(false);
  };

  const handleSoundFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await apiUpdateSoundConfig({ soundFile: file });
      setSoundSettings({
        volume: data.volume,
        enabled: data.enabled,
        soundUrl: data.soundUrl,
        soundFileName: data.soundFileName,
      });
    } catch (err) {
      console.error("Failed to upload custom sound:", err);
    }
    e.target.value = "";
  };

  const handleResetSound = async () => {
    try {
      const data = await apiUpdateSoundConfig({ resetToDefault: true });
      setSoundSettings({
        volume: data.volume,
        enabled: data.enabled,
        soundUrl: data.soundUrl,
        soundFileName: data.soundFileName,
      });
    } catch (err) {
      console.error("Failed to reset sound:", err);
    }
  };

  // Determine if current sound is custom
  const isCustomSound = soundSettings.soundUrl !== "/intellidraw-v2.mp3";

  return (
    <div className="bg-surface min-h-screen text-on-surface font-body p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center gap-4 border-b border-outline-variant/30 pb-6">
          <button
            onClick={() => navigate("/dashboard")}
            className="material-symbols-outlined p-2 rounded-full hover:bg-surface-container transition-colors"
          >
            arrow_back
          </button>
          <div>
            <h1 className="text-2xl font-bold font-manrope tracking-tight text-primary">Global Admin Dashboard</h1>
            <p className="text-sm text-on-surface-variant">Manage Evaluator Sanitization Rules</p>
          </div>
        </header>

        {/* ─── Sound Effects Configuration ─────────────────────── */}
        <section className="bg-white rounded-2xl p-6 border border-outline-variant/20 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="material-symbols-outlined text-2xl text-primary"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                volume_up
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-on-surface">Sound Effects</h2>
                <p className="text-xs text-on-surface-variant">Notification sound when the canvas updates</p>
              </div>
            </div>

            {/* Enable / disable toggle */}
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
          </div>

          <div className={`space-y-6 transition-opacity duration-200 ${soundSettings.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
            {/* Volume slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-on-surface-variant">Volume</label>
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                  {Math.round(soundSettings.volume * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-lg text-on-surface-variant/50">volume_mute</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={soundSettings.volume}
                  onChange={handleVolumeChange}
                  className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-primary bg-surface-container-high"
                  style={{
                    background: `linear-gradient(to right, var(--md-sys-color-primary, #6750A4) 0%, var(--md-sys-color-primary, #6750A4) ${soundSettings.volume * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) ${soundSettings.volume * 100}%, var(--md-sys-color-surface-container-high, #E6E0E9) 100%)`,
                  }}
                />
                <span className="material-symbols-outlined text-lg text-on-surface-variant/50">volume_up</span>
              </div>
            </div>

            {/* Current sound + actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Current sound indicator */}
              <div className="flex-1 flex items-center gap-3 bg-surface-container-lowest border border-outline-variant/15 rounded-xl px-4 py-3">
                <span
                  className="material-symbols-outlined text-lg text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  music_note
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">
                    {isCustomSound ? (soundSettings.soundFileName || "Custom Sound") : "IntelliDraw v2 (Default)"}
                  </p>
                  <p className="text-[11px] text-on-surface-variant">
                    {isCustomSound ? "Custom upload" : "Bundled notification"}
                  </p>
                </div>
              </div>

              {/* Preview button */}
              <button
                onClick={handlePreviewSound}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-secondary-fixed text-on-secondary-fixed-variant text-sm font-bold rounded-xl hover:bg-secondary-fixed-dim transition-colors active:scale-95"
              >
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {previewPlaying ? "stop_circle" : "play_circle"}
                </span>
                {previewPlaying ? "Playing..." : "Preview"}
              </button>
            </div>

            {/* Replace / Reset  */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-outline-variant/10">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-surface-container-high text-on-surface text-sm font-bold rounded-xl hover:bg-surface-container-highest transition-colors active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">upload_file</span>
                Replace Sound
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="audio/*"
                onChange={handleSoundFileUpload}
              />

              {isCustomSound && (
                <button
                  onClick={handleResetSound}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-on-surface-variant text-sm font-bold rounded-xl border border-outline-variant/20 hover:bg-surface-container-high transition-colors active:scale-95"
                >
                  <span className="material-symbols-outlined text-lg">restart_alt</span>
                  Reset to Default
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-6 border border-outline-variant/20 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight text-on-surface mb-4">Add Sanitization Rule</h2>
          <form onSubmit={handleAddRule} className="flex gap-3">
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
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-on-surface px-2">Active Rules ({rules.length})</h2>
          
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
        </section>
      </div>
    </div>
  );
}
