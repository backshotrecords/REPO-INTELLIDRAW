import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiConsumeResetToken } from "../lib/api";

type ResetState = "form" | "success" | "error";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [state, setState] = useState<ResetState>(token ? "form" : "error");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(token ? "" : "No reset token found in the URL.");

  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = Boolean(token && newPassword.length >= 6 && passwordsMatch && !loading);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setErrorMsg("");

    if (newPassword.length < 6) {
      setErrorMsg("New password must be at least 6 characters.");
      return;
    }

    if (!passwordsMatch) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await apiConsumeResetToken(token, newPassword);
      setState("success");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-outline-variant/20 shadow-lg p-8 text-center space-y-6">
          <div
            className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${
              state === "success"
                ? "bg-green-50"
                : state === "error"
                ? "bg-error-container/30"
                : "bg-primary/10"
            }`}
          >
            <span
              className={`material-symbols-outlined text-3xl ${
                state === "success"
                  ? "text-green-600"
                  : state === "error"
                  ? "text-error"
                  : "text-primary"
              }`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {state === "success" ? "check_circle" : state === "error" ? "error" : "lock_reset"}
            </span>
          </div>

          {state === "form" && (
            <>
              <div>
                <h1 className="text-xl font-bold font-manrope text-on-surface">
                  Choose a New Password
                </h1>
                <p className="text-sm text-on-surface-variant mt-2">
                  Enter a new password for your IntelliDraw account.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 text-left">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-on-surface">New Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 pr-12 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                      minLength={6}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="pw-toggle-btn absolute right-3 top-1/2 -translate-y-1/2"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-on-surface">Confirm Password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                    minLength={6}
                    required
                  />
                </div>

                {confirmPassword && !passwordsMatch && (
                  <p className="text-sm text-error font-medium">Passwords do not match.</p>
                )}

                {errorMsg && (
                  <div className="bg-error-container/30 text-on-error-container text-sm p-3 rounded-xl border border-error/10">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors active:scale-95 w-full disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">
                    {loading ? "progress_activity" : "lock_reset"}
                  </span>
                  {loading ? "Updating..." : "Update Password"}
                </button>
              </form>
            </>
          )}

          {state === "success" && (
            <>
              <h1 className="text-xl font-bold font-manrope text-on-surface">
                Password Reset Complete
              </h1>
              <p className="text-sm text-on-surface-variant">
                Your password has been updated. Please log in with your new password.
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <h1 className="text-xl font-bold font-manrope text-on-surface">
                Reset Link Problem
              </h1>
              <p className="text-sm text-error">{errorMsg}</p>
              <p className="text-xs text-on-surface-variant">
                The link may be invalid, expired, or already used. Request a new reset link to continue.
              </p>
            </>
          )}

          {state !== "form" && (
            <div className="space-y-3">
              <button
                onClick={() => navigate("/")}
                className="inline-flex items-center justify-center gap-2 bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 transition-colors active:scale-95 w-full"
              >
                <span className="material-symbols-outlined text-lg">login</span>
                Go to Login
              </button>
              {state === "error" && (
                <button
                  onClick={() => navigate("/forgot-password")}
                  className="w-full text-sm font-bold text-secondary hover:underline"
                >
                  Request a new link
                </button>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-on-surface-variant/40 mt-6">
          IntelliDraw - AI Flowchart Generator
        </p>
      </div>
    </main>
  );
}
