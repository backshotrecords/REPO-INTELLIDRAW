import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiCheckSignupVerification, apiCompleteSignupVerification } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

type PageState = "checking" | "ready" | "submitting" | "success" | "error";

export default function VerifySignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const token = searchParams.get("token") || "";
  const payload = searchParams.get("payload") || "";
  const [pageState, setPageState] = useState<PageState>("checking");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const isBusy = pageState === "checking" || pageState === "submitting" || pageState === "success";
  const title = useMemo(() => {
    if (pageState === "checking") return "Checking verification link";
    if (pageState === "success") return "Account created";
    if (pageState === "error") return "Verification issue";
    return "Create your IntelliDraw account";
  }, [pageState]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !payload) {
      setPageState("error");
      setMessage("Verification link is missing required data.");
      return;
    }

    apiCheckSignupVerification(token, payload)
      .then(() => {
        if (!cancelled) {
          setPageState("ready");
          setMessage("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPageState("error");
          setMessage(err instanceof Error ? err.message : "Verification link is invalid or expired.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [payload, token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || isBusy) return;

    setPageState("submitting");
    setMessage("Verifying password and creating your account...");
    setAttemptsRemaining(null);

    try {
      await apiCompleteSignupVerification(token, payload, password);
      setPageState("success");
      setMessage("Setup complete. Taking you to your dashboard...");
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const typedError = err as Error & { attemptsRemaining?: number };
      setPageState("ready");
      setMessage(typedError.message || "Failed to verify signup.");
      setAttemptsRemaining(
        typeof typedError.attemptsRemaining === "number"
          ? typedError.attemptsRemaining
          : null
      );
    }
  };

  const startOver = () => {
    navigate("/?mode=signup", { replace: true });
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-surface">
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-secondary-fixed/20 blur-[100px]" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] rounded-full bg-tertiary-fixed/30 blur-[80px]" />

      <div className="w-full max-w-md z-10 space-y-10">
        <header className="flex flex-col items-center text-center">
          <div className="mb-4">
            <span
              className="material-symbols-outlined text-6xl text-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              draw
            </span>
          </div>
          <h1 className="font-headline font-extrabold text-4xl tracking-tight text-primary">
            {title}
          </h1>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          {(pageState === "checking" || pageState === "submitting" || pageState === "success") && (
            <div className="bg-surface-container-high text-on-surface text-sm p-4 rounded-xl border border-outline/10 flex items-center gap-3">
              <span className="spinner" />
              <span>{message || "Checking verification link..."}</span>
            </div>
          )}

          {pageState === "error" && (
            <div className="bg-error-container/30 text-on-error-container text-sm p-4 rounded-xl border border-error/10">
              {message}
            </div>
          )}

          {pageState === "ready" && (
            <>
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-widest text-on-surface-variant ml-1 font-label">
                  Original Signup Password
                </label>
                <div className="relative">
                  <input
                    className="w-full bg-surface-container-high border-none rounded-xl px-4 py-4 pr-12 text-on-surface focus:ring-2 focus:ring-secondary transition-all outline-none placeholder:text-outline/50"
                    placeholder="Enter the password you chose"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setMessage("");
                      setAttemptsRemaining(null);
                    }}
                    required
                    minLength={6}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="pw-toggle-btn absolute right-3 top-1/2 -translate-y-1/2"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>

              {message && (
                <div className="bg-error-container/30 text-on-error-container text-sm p-3 rounded-xl border border-error/10">
                  {message}
                  {attemptsRemaining !== null && attemptsRemaining > 0 && (
                    <span className="block mt-1 text-xs">
                      {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} remaining.
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={!password || isBusy}
                  className="editorial-gradient flex-1 py-4 rounded-xl text-white font-headline font-bold text-base active:scale-95 transition-transform duration-200 shadow-xl shadow-primary/10 disabled:opacity-50"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={startOver}
                  className="px-5 py-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-headline font-semibold text-base transition-all duration-200 active:scale-95 border border-outline/10"
                >
                  Start Over
                </button>
              </div>
            </>
          )}

          {pageState === "error" && (
            <button
              type="button"
              onClick={startOver}
              className="w-full py-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-headline font-semibold text-base transition-all duration-200 active:scale-95 border border-outline/10"
            >
              Start Over
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
