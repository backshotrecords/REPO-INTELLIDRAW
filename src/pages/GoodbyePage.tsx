import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { apiSubmitExitInterview, removeToken } from "../lib/api";

/**
 * Goodbye page shown after account deletion.
 * Unauthenticated — receives name/email via Router state.
 */
export default function GoodbyePage() {
  const location = useLocation();
  const state = (location.state || {}) as { name?: string; email?: string };
  const userName = state.name || "friend";
  const userEmail = state.email || "";

  // Clear the JWT session on mount — the user's account is already deleted,
  // we just delayed token removal so ProtectedRoute wouldn't hijack navigation.
  useEffect(() => {
    removeToken();
  }, []);

  // Exit interview state
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Countdown state — only starts after submission
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Handle countdown tick
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      window.location.href = "https://intellidraw.dev";
      return;
    }
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          window.location.href = "https://intellidraw.dev";
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [countdown !== null]); // Only run when countdown starts

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await apiSubmitExitInterview(userEmail, userName, reason.trim());
      setSubmitted(true);
      // Start 3-second countdown after a brief pause to let the user read the thank-you
      setTimeout(() => setCountdown(3), 2000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    window.location.href = "https://intellidraw.dev";
  };

  return (
    <div className="min-h-screen bg-background font-body text-on-surface flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-8">
        {/* Farewell icon */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-surface-container-low border border-outline-variant/15 mb-6">
            <span
              className="material-symbols-outlined text-4xl text-on-surface-variant"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              waving_hand
            </span>
          </div>
        </div>

        {/* Main card */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="p-8 pb-0 text-center space-y-3">
            <h1 className="text-3xl font-bold text-on-surface tracking-tight font-headline">
              We're sorry to see you go{userName !== "friend" ? `, ${userName}` : ""}.
            </h1>
            <p className="text-on-surface-variant text-sm leading-relaxed">
              Your account has been permanently deleted.
            </p>
          </div>

          {/* Messages */}
          <div className="px-8 py-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
              <span className="material-symbols-outlined text-lg text-primary mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
                auto_awesome
              </span>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                <span className="text-on-surface font-semibold">IntelliDraw keeps improving every week.</span>{" "}
                We're building the best flowchart, system design, architecture, and thought assistance possible with modern technology.
              </p>
            </div>

            <div className="flex items-start gap-3 p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
              <span className="material-symbols-outlined text-lg text-secondary mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
                card_giftcard
              </span>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                <span className="text-on-surface font-semibold">You're always welcome back.</span>{" "}
                When you're ready, return for a <span className="text-secondary font-bold">free one-month trial</span> — no strings attached.
              </p>
            </div>
          </div>

          {/* Exit Interview */}
          <div className="px-8 pb-8 space-y-4">
            {!submitted ? (
              <>
                <div className="border-t border-outline-variant/15 pt-6">
                  <label className="text-sm font-semibold text-on-surface block mb-2">
                    Why did you leave? <span className="text-on-surface-variant font-normal">(final step)</span>
                  </label>
                  <textarea
                    id="exit-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us what we could do better..."
                    rows={3}
                    className="w-full bg-surface-container-high border-none rounded-xl px-4 py-3 text-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-2 focus:ring-secondary/20 outline-none resize-none transition-all"
                  />
                </div>

                {submitError && (
                  <p className="text-sm text-error font-medium flex items-center gap-2">
                    <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                    {submitError}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!reason.trim() || submitting}
                    className="flex-1 px-6 py-3 editorial-gradient text-white text-sm font-bold rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {submitting ? "progress_activity" : "send"}
                    </span>
                    {submitting ? "Submitting..." : "Submit Feedback"}
                  </button>
                </div>
              </>
            ) : (
              <div className="border-t border-outline-variant/15 pt-6 text-center space-y-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary/10 mb-2">
                  <span className="material-symbols-outlined text-2xl text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    favorite
                  </span>
                </div>
                <p className="text-on-surface font-bold text-lg">Thank you for your feedback ❤️</p>
                <p className="text-on-surface-variant text-sm">Your response helps us improve IntelliDraw for everyone.</p>
              </div>
            )}
          </div>
        </div>

        {/* Countdown / Skip */}
        <div className="text-center space-y-3">
          {countdown !== null && countdown > 0 && (
            <p className="text-on-surface-variant text-sm font-medium animate-pulse">
              Redirecting to IntelliDraw in{" "}
              <span className="text-on-surface font-bold text-lg">{countdown}</span>...
            </p>
          )}
          <button
            onClick={handleSkip}
            className="text-on-surface-variant/60 hover:text-on-surface-variant text-sm font-medium transition-colors inline-flex items-center gap-1"
          >
            Go to IntelliDraw now
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}
