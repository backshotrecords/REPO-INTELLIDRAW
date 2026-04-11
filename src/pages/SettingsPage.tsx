import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import {
  apiGetSettings,
  apiUpdateProfile,
  apiSaveApiKey,
  apiGetApiKey,
  apiTestConnection,
  apiGetModels,
  apiAddModel,
  apiDeleteModel,
  apiSetActiveModel,
} from "../lib/api";

interface AIModel {
  id: string;
  model_id: string;
  label: string;
  added_at: string;
}

export default function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();

  // Profile state
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // API Key state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [rawApiKey, setRawApiKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");

  // Connection test
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    message: string;
  } | null>(null);

  // Models state
  const [models, setModels] = useState<AIModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [newModelId, setNewModelId] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [addingModel, setAddingModel] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    loadSettings();
    loadModels();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await apiGetSettings();
      setDisplayName(data.user.displayName);
      setEmail(data.user.email);
      setHasKey(data.user.hasApiKey);
      if (data.user.hasApiKey) {
        setApiKeyInput(""); // Don't show the actual key
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadModels = async () => {
    try {
      const data = await apiGetModels();
      setModels(data.models);
      setActiveModelId(data.activeModelId);
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMessage("");
    try {
      await apiUpdateProfile(displayName, email);
      await refreshUser();
      setProfileMessage("Profile updated successfully");
      setTimeout(() => setProfileMessage(""), 3000);
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setKeySaving(true);
    setKeyMessage("");
    try {
      await apiSaveApiKey(apiKeyInput.trim());
      setHasKey(true);
      setApiKeyInput("");
      setRawApiKey(null);
      setShowKey(false);
      setKeyMessage("API key saved and encrypted");
      setTimeout(() => setKeyMessage(""), 3000);
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setKeySaving(false);
    }
  };

  const handleShowKey = async () => {
    if (showKey) {
      setShowKey(false);
      setRawApiKey(null);
      return;
    }
    try {
      const data = await apiGetApiKey();
      setRawApiKey(data.apiKey);
      setShowKey(true);
    } catch (err) {
      console.error("Failed to get API key:", err);
    }
  };

  const handleCopyKey = async () => {
    if (!rawApiKey) {
      // Fetch key first
      try {
        const data = await apiGetApiKey();
        if (data.apiKey) {
          await navigator.clipboard.writeText(data.apiKey);
          setCopyMessage("Copied to clipboard!");
          setTimeout(() => setCopyMessage(""), 2000);
        }
      } catch {
        setCopyMessage("Failed to copy");
        setTimeout(() => setCopyMessage(""), 2000);
      }
    } else {
      await navigator.clipboard.writeText(rawApiKey);
      setCopyMessage("Copied to clipboard!");
      setTimeout(() => setCopyMessage(""), 2000);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectionStatus(null);
    try {
      const data = await apiTestConnection();
      setConnectionStatus(data);
    } catch (err) {
      setConnectionStatus({
        connected: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAddModel = async () => {
    if (!newModelId.trim()) return;
    setAddingModel(true);
    try {
      await apiAddModel(newModelId.trim(), newModelLabel.trim() || newModelId.trim());
      setNewModelId("");
      setNewModelLabel("");
      await loadModels();
    } catch (err) {
      console.error("Failed to add model:", err);
    } finally {
      setAddingModel(false);
    }
  };

  const handleDeleteModel = async (id: string) => {
    try {
      await apiDeleteModel(id);
      await loadModels();
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  const handleSetActiveModel = async (modelDbId: string) => {
    try {
      await apiSetActiveModel(modelDbId);
      setActiveModelId(modelDbId);
      await refreshUser();
    } catch (err) {
      console.error("Failed to set active model:", err);
    }
  };

  return (
    <div className="bg-background font-body text-on-surface min-h-screen pb-32">
      <TopBar />

      <main className="max-w-4xl mx-auto px-6 pt-12 space-y-16">
        {/* Header */}
        <section className="space-y-2">
          <h2 className="text-4xl font-headline font-extrabold tracking-tight text-primary">
            Settings
          </h2>
          <p className="text-on-surface-variant text-lg">
            Manage your workspace precision and intelligence configurations.
          </p>
        </section>

        {/* Account Details */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-headline font-bold text-primary">Account Details</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              Update your profile and preferences.
            </p>
          </div>
          <div className="md:col-span-2 space-y-6">
            <div className="bg-surface-container-low rounded-xl p-8 space-y-8">
              {/* Avatar */}
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-primary-container flex items-center justify-center text-on-primary font-bold text-3xl font-headline shadow-sm">
                  {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div>
                  <p className="text-2xl font-headline font-bold text-on-surface">
                    {user?.displayName}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-on-surface-variant">Full Name</label>
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-secondary/20 transition-all outline-none"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-on-surface-variant">
                    Email Address
                  </label>
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-secondary/20 transition-all outline-none"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {profileMessage && (
                <p className="text-sm text-secondary font-medium">{profileMessage}</p>
              )}

              <div className="pt-4 flex justify-end gap-4">
                <button
                  onClick={loadSettings}
                  className="px-6 py-2.5 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded-xl transition-colors"
                >
                  Discard Changes
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className="px-8 py-2.5 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50"
                >
                  {profileSaving ? "Saving..." : "Save Account Settings"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* API Configuration */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-headline font-bold text-primary">API Configuration</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              Connect your own AI models for custom rendering logic and semantic analysis.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/15 shadow-sm space-y-8">
              {/* Info banner */}
              <div className="flex items-center gap-4 p-4 bg-tertiary-container rounded-lg">
                <span
                  className="material-symbols-outlined text-on-tertiary-fixed"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  info
                </span>
                <p className="text-sm text-tertiary-fixed">
                  Your API keys are encrypted at rest and never visible to our support team.
                </p>
              </div>

              {/* API Key input */}
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between flex-wrap gap-2">
                    <label className="text-sm font-semibold text-on-surface">OpenAI API Key</label>
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-secondary font-semibold hover:underline"
                    >
                      Get key from dashboard
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      className="w-full bg-surface-container-high border-none rounded-lg pl-4 pr-24 py-4 focus:ring-2 focus:ring-secondary/20 transition-all outline-none font-mono text-sm"
                      placeholder="sk-..."
                      type={showKey ? "text" : "password"}
                      value={showKey && rawApiKey ? rawApiKey : apiKeyInput}
                      onChange={(e) => {
                        if (!showKey) setApiKeyInput(e.target.value);
                      }}
                      readOnly={showKey && !!rawApiKey}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {hasKey && (
                        <>
                          <button
                            onClick={handleShowKey}
                            className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                            title={showKey ? "Hide key" : "Show key"}
                          >
                            <span className="material-symbols-outlined text-lg">
                              {showKey ? "visibility_off" : "visibility"}
                            </span>
                          </button>
                          <button
                            onClick={handleCopyKey}
                            className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                            title="Copy key"
                          >
                            <span className="material-symbols-outlined text-lg">content_copy</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {copyMessage && (
                    <p className="text-xs text-secondary font-medium">{copyMessage}</p>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-4">
                  <button
                    onClick={handleSaveApiKey}
                    disabled={keySaving || !apiKeyInput.trim()}
                    className="flex-1 px-8 py-3.5 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[20px]">save</span>
                    {keySaving ? "Saving..." : "Save Key"}
                  </button>
                  <button
                    onClick={handleTestConnection}
                    disabled={testing || !hasKey}
                    className="flex-1 px-8 py-3.5 bg-secondary-fixed text-on-secondary-fixed-variant text-sm font-bold rounded-xl hover:bg-secondary-fixed-dim transition-colors active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[20px]">bolt</span>
                    {testing ? "Testing..." : "Test Connection"}
                  </button>
                </div>

                {keyMessage && (
                  <p className="text-sm text-secondary font-medium">{keyMessage}</p>
                )}
              </div>

              {/* Connection Status */}
              {connectionStatus && (
                <div className="flex items-center gap-3 p-4 bg-surface-container-low rounded-lg">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      connectionStatus.connected
                        ? "bg-emerald-500 animate-pulse"
                        : "bg-error"
                    }`}
                  />
                  <p className="text-xs font-semibold text-on-surface-variant">
                    {connectionStatus.message}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Model Configuration */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-headline font-bold text-primary">AI Models</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              Add and switch between OpenAI models. The active model is used for all AI operations.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/15 shadow-sm space-y-6">
              {/* Model list */}
              <div className="space-y-3">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className={`flex items-center justify-between p-4 rounded-xl transition-all ${
                      activeModelId === model.id
                        ? "bg-secondary/5 border-2 border-secondary/30"
                        : "bg-surface-container-low hover:bg-surface-container-high border-2 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleSetActiveModel(model.id)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          activeModelId === model.id
                            ? "border-secondary bg-secondary"
                            : "border-outline-variant"
                        }`}
                      >
                        {activeModelId === model.id && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </button>
                      <div>
                        <p className="text-sm font-bold text-on-surface font-mono">
                          {model.model_id}
                        </p>
                        {model.label && model.label !== model.model_id && (
                          <p className="text-xs text-on-surface-variant">{model.label}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeModelId === model.id && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-secondary bg-secondary/10 px-2 py-1 rounded-full">
                          Active
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteModel(model.id)}
                        className="p-1.5 text-on-surface-variant/50 hover:text-error transition-colors rounded-lg hover:bg-error-container/20"
                      >
                        <span className="material-symbols-outlined text-lg">close</span>
                      </button>
                    </div>
                  </div>
                ))}

                {models.length === 0 && (
                  <p className="text-sm text-on-surface-variant/50 text-center py-4">
                    No models configured. Add one below.
                  </p>
                )}
              </div>

              {/* Add model form */}
              <div className="pt-4 border-t border-outline-variant/10">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
                  Add New Model
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    className="flex-1 bg-surface-container-high border-none rounded-lg px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-secondary/20 outline-none"
                    placeholder="Model ID (e.g. gpt-4o)"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                  />
                  <input
                    className="flex-1 bg-surface-container-high border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-secondary/20 outline-none"
                    placeholder="Label (optional)"
                    value={newModelLabel}
                    onChange={(e) => setNewModelLabel(e.target.value)}
                  />
                  <button
                    onClick={handleAddModel}
                    disabled={addingModel || !newModelId.trim()}
                    className="px-6 py-3 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50 whitespace-nowrap"
                  >
                    {addingModel ? "Adding..." : "Add Model"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-headline font-bold text-error">Danger Zone</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              Account actions that cannot be undone.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="bg-error-container/30 rounded-xl p-8 border border-error/10 space-y-6">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <p className="font-bold text-on-error-container">Log Out</p>
                  <p className="text-sm text-on-error-container/70">
                    Sign out of your IntelliDraw account.
                  </p>
                </div>
                <button
                  onClick={logout}
                  className="px-6 py-2.5 text-error font-bold border border-error/20 hover:bg-error/10 rounded-xl transition-colors whitespace-nowrap"
                >
                  Log Out
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
