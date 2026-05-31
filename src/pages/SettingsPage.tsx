import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import {
  apiGetSettings,
  apiUpdateProfile,
  apiSaveApiKey,
  apiGetApiKey,
  apiTestConnection,
  apiChangePassword,
  apiVerifyPassword,
  apiDeleteMyAccount,
} from "../lib/api";


export default function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  // Profile state
  const [displayName, setDisplayName] = useState("");

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  // API Key state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [rawApiKey, setRawApiKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [apiKeyManagedByAdmin, setApiKeyManagedByAdmin] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");

  // Connection test
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    message: string;
  } | null>(null);

  const [copyMessage, setCopyMessage] = useState("");

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [currentPasswordValid, setCurrentPasswordValid] = useState<boolean | null>(null);
  const [currentPasswordChecking, setCurrentPasswordChecking] = useState(false);
  const [passwordChangeSaving, setPasswordChangeSaving] = useState(false);
  const [passwordChangeMessage, setPasswordChangeMessage] = useState("");
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Account deletion state
  const [deleteStep, setDeleteStep] = useState(0); // 0=hidden, 1=warning1, 2=warning2, 3=email-confirm
  const [deleteEmailInput, setDeleteEmailInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    };
  }, []);

  // Debounced verification of current password
  const debouncedVerifyPassword = useCallback((password: string) => {
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    if (!password || password.length < 1) {
      setCurrentPasswordValid(null);
      setCurrentPasswordChecking(false);
      return;
    }
    setCurrentPasswordChecking(true);
    verifyTimerRef.current = setTimeout(async () => {
      try {
        const valid = await apiVerifyPassword(password);
        setCurrentPasswordValid(valid);
      } catch {
        setCurrentPasswordValid(null);
      } finally {
        setCurrentPasswordChecking(false);
      }
    }, 600);
  }, []);

  const handleCurrentPasswordChange = (value: string) => {
    setCurrentPassword(value);
    debouncedVerifyPassword(value);
  };

  const passwordsMatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordChangeError("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordChangeError("New password must be at least 6 characters");
      return;
    }
    setPasswordChangeSaving(true);
    setPasswordChangeMessage("");
    setPasswordChangeError("");
    try {
      await apiChangePassword(currentPassword, newPassword);
      setPasswordChangeMessage("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPasswordValid(null);
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setTimeout(() => setPasswordChangeMessage(""), 4000);
    } catch (err) {
      setPasswordChangeError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordChangeSaving(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await apiGetSettings();
      setDisplayName(data.user.displayName ?? "");
      setProfileError("");

      setHasKey(data.user.hasApiKey);
      setApiKeyManagedByAdmin(data.user.apiKeyManagedByAdmin ?? false);
      if (data.user.hasApiKey) {
        setApiKeyInput(""); // Don't show the actual key
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };


  const handleSaveProfile = async () => {
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setProfileMessage("");
      setProfileError("Please enter your full name before saving account settings.");
      return;
    }

    setProfileSaving(true);
    setProfileMessage("");
    setProfileError("");
    try {
      await apiUpdateProfile(trimmedDisplayName);
      await refreshUser();
      setDisplayName(trimmedDisplayName);
      setProfileMessage("Profile updated successfully");
      setTimeout(() => setProfileMessage(""), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update");
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
      setApiKeyManagedByAdmin(false);
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
    if (apiKeyManagedByAdmin) {
      setKeyMessage("This API key is managed by an administrator and cannot be revealed.");
      setTimeout(() => setKeyMessage(""), 3000);
      return;
    }
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
      setKeyMessage(err instanceof Error ? err.message : "Failed to get API key");
      setTimeout(() => setKeyMessage(""), 3000);
    }
  };

  const handleCopyKey = async () => {
    if (apiKeyManagedByAdmin) {
      setCopyMessage("Admin-managed keys cannot be copied");
      setTimeout(() => setCopyMessage(""), 2000);
      return;
    }
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

  // ── Account Deletion Handler ────────────────────────────
  const handleDeleteAccount = async () => {
    if (!user) return;
    setIsDeleting(true);
    setDeleteError("");

    // Capture user info before deletion
    const deletedName = user.displayName || "";
    const deletedEmail = user.email || "";

    try {
      await apiDeleteMyAccount(deleteEmailInput.trim());
      // Navigate FIRST — don't logout() here or ProtectedRoute will
      // redirect to "/" before the navigate can fire.
      // The GoodbyePage clears the session on mount.
      navigate("/goodbye", {
        state: { name: deletedName, email: deletedEmail },
        replace: true,
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setDeleteStep(0);
    setDeleteEmailInput("");
    setDeleteError("");
  };

  const emailMatches =
    deleteEmailInput.trim().toLowerCase() === (user?.email || "").toLowerCase() &&
    deleteEmailInput.trim().length > 0;

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

              <div className="space-y-2">
                <label className="text-sm font-medium text-on-surface-variant">Full Name</label>
                <input
                  className={`w-full bg-surface-container-high border-none rounded-lg px-4 py-3 focus:ring-2 transition-all outline-none ${
                    profileError ? "ring-2 ring-error/30 focus:ring-error/30" : "focus:ring-secondary/20"
                  }`}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    if (profileError) setProfileError("");
                  }}
                  aria-invalid={profileError ? "true" : "false"}
                />
              </div>

              {profileError && (
                <p className="text-sm text-error font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                  {profileError}
                </p>
              )}

              {profileMessage && (
                <p className="text-sm text-secondary font-medium">{profileMessage}</p>
              )}

              <div className="pt-4 flex justify-end gap-4">
                <button
                  onClick={() => {
                    setProfileError("");
                    setProfileMessage("");
                    loadSettings();
                  }}
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

        {/* Change Password */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1">
            <h3 className="text-xl font-headline font-bold text-primary">Change Password</h3>
            <p className="text-sm text-on-surface-variant mt-2">
              Update your account password. You must verify your current password first.
            </p>
          </div>
          <div className="md:col-span-2">
            <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/15 shadow-sm space-y-6">
              {/* Current Password */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-on-surface">Current Password</label>
                <div className="relative">
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg pl-4 pr-20 py-4 focus:ring-2 focus:ring-secondary/20 transition-all outline-none text-sm"
                    placeholder="Enter your current password"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => handleCurrentPasswordChange(e.target.value)}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {/* Verification indicator */}
                    {currentPassword.length > 0 && (
                      currentPasswordChecking ? (
                        <span className="pw-indicator pw-indicator-checking">
                          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        </span>
                      ) : currentPasswordValid === true ? (
                        <span className="pw-indicator pw-indicator-valid">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                        </span>
                      ) : currentPasswordValid === false ? (
                        <span className="pw-indicator pw-indicator-invalid">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                        </span>
                      ) : null
                    )}
                    {/* Show/hide toggle */}
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="pw-toggle-btn"
                      title={showCurrentPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        {showCurrentPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-on-surface">New Password</label>
                <div className="relative">
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg pl-4 pr-20 py-4 focus:ring-2 focus:ring-secondary/20 transition-all outline-none text-sm"
                    placeholder="Enter new password (min 6 characters)"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="pw-toggle-btn"
                      title={showNewPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        {showNewPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Confirm New Password */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-on-surface">Confirm New Password</label>
                <div className="relative">
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg pl-4 pr-20 py-4 focus:ring-2 focus:ring-secondary/20 transition-all outline-none text-sm"
                    placeholder="Re-enter new password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {/* Match indicator */}
                    {confirmPassword.length > 0 && (
                      passwordsMatch ? (
                        <span className="pw-indicator pw-indicator-valid">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                        </span>
                      ) : passwordsMismatch ? (
                        <span className="pw-indicator pw-indicator-invalid">
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
                        </span>
                      ) : null
                    )}
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="pw-toggle-btn"
                      title={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        {showConfirmPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages */}
              {passwordChangeMessage && (
                <p className="text-sm text-emerald-600 font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  {passwordChangeMessage}
                </p>
              )}
              {passwordChangeError && (
                <p className="text-sm text-error font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                  {passwordChangeError}
                </p>
              )}

              {/* Submit */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleChangePassword}
                  disabled={
                    passwordChangeSaving ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword ||
                    !passwordsMatch ||
                    currentPasswordValid !== true
                  }
                  className="px-8 py-2.5 editorial-gradient text-white text-sm font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50 flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[20px]">lock</span>
                  {passwordChangeSaving ? "Updating..." : "Update Password"}
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
                      placeholder={apiKeyManagedByAdmin ? "Managed by administrator" : "sk-..."}
                      type={showKey ? "text" : "password"}
                      value={showKey && rawApiKey ? rawApiKey : apiKeyInput}
                      onChange={(e) => {
                        if (!showKey) setApiKeyInput(e.target.value);
                      }}
                      readOnly={showKey && !!rawApiKey}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {hasKey && !apiKeyManagedByAdmin && (
                        <>
                          <button
                            onClick={handleShowKey}
                            className="pw-toggle-btn"
                            title={showKey ? "Hide key" : "Show key"}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
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
                  {apiKeyManagedByAdmin && (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
                      <span className="material-symbols-outlined text-primary text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                        admin_panel_settings
                      </span>
                      <p className="text-xs text-on-surface-variant">
                        This key was added by an administrator. You can use it, but you cannot reveal or copy it.
                      </p>
                    </div>
                  )}
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 items-start">
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

              {/* Delete Account */}
              <div className="border-t border-error/10 pt-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 items-start">
                  <div>
                    <p className="font-bold text-on-error-container">Delete My Account</p>
                    <p className="text-sm text-on-error-container/70">
                      Permanently delete your account and all associated data. This cannot be undone.
                    </p>
                  </div>
                  <button
                    id="delete-account-btn"
                    onClick={() => setDeleteStep(1)}
                    className="px-6 py-2.5 bg-error text-white font-bold rounded-xl hover:bg-error/90 transition-colors active:scale-95 whitespace-nowrap flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>delete_forever</span>
                    Delete My Account
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Delete Account Confirmation Modal ══════════════════ */}
        {deleteStep > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 max-w-md w-full mx-4 overflow-hidden">
              {/* Header */}
              <div className="p-5 bg-error/5 border-b border-error/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-error text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {deleteStep === 1 ? "warning" : deleteStep === 2 ? "delete_forever" : "mail"}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-on-surface">
                      {deleteStep === 1
                        ? "Delete Your Account?"
                        : deleteStep === 2
                          ? "Final Warning"
                          : "Confirm Your Identity"}
                    </h3>
                    <p className="text-xs text-on-surface-variant">{user?.email}</p>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-5 space-y-3">
                {deleteStep === 1 && (
                  <>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      This will <span className="font-bold text-error">permanently delete</span> your account and all associated data:
                    </p>
                    <ul className="text-sm text-on-surface-variant space-y-1.5 ml-1">
                      <li className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-error/60">dashboard</span>
                        All canvases and flowcharts
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
                  </>
                )}

                {deleteStep === 2 && (
                  <div className="bg-error/5 border border-error/20 rounded-xl p-4">
                    <p className="text-sm font-bold text-error">⚠ This action is irreversible.</p>
                    <p className="text-sm text-on-surface-variant mt-1">
                      Are you absolutely sure you want to permanently destroy all of your data? There is no way to recover your account after this.
                    </p>
                  </div>
                )}

                {deleteStep === 3 && (
                  <>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      To confirm, please type your email address: <span className="font-bold text-on-surface">{user?.email}</span>
                    </p>
                    <input
                      id="delete-email-confirm"
                      type="email"
                      value={deleteEmailInput}
                      onChange={(e) => { setDeleteEmailInput(e.target.value); setDeleteError(""); }}
                      placeholder="Type your email to confirm"
                      className="w-full bg-surface-container-high border-none rounded-lg px-4 py-3 focus:ring-2 focus:ring-error/20 transition-all outline-none text-sm"
                      autoComplete="off"
                    />
                    {deleteEmailInput.length > 0 && !emailMatches && (
                      <p className="text-xs text-error font-medium flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">close</span>
                        Email does not match
                      </p>
                    )}
                    {emailMatches && (
                      <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                        Email confirmed
                      </p>
                    )}
                  </>
                )}

                {deleteError && (
                  <p className="text-sm text-error font-medium flex items-center gap-2">
                    <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                    {deleteError}
                  </p>
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
                {deleteStep < 3 ? (
                  <button
                    onClick={() => setDeleteStep((s) => s + 1)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all active:scale-95 bg-error/10 text-error hover:bg-error/20 border border-error/30"
                  >
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_forward</span>
                    Continue
                  </button>
                ) : (
                  <button
                    onClick={handleDeleteAccount}
                    disabled={!emailMatches || isDeleting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 bg-error text-white hover:bg-error/90"
                  >
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {isDeleting ? "progress_activity" : "delete_forever"}
                    </span>
                    {isDeleting ? "Deleting..." : "Delete My Account"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
