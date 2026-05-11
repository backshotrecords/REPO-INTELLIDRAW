import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { apiSubmitExitInterview } from "../lib/api";

/**
 * Goodbye page shown after account deletion.
 * Unauthenticated — receives name/email via Router state.
 */
export default function GoodbyePage() {
  const location = useLocation();
  const state = (location.state || {}) as { name?: string; email?: string };
  const userName = state.name || "friend";
  const userEmail = state.email || "";

  // Exit interview state
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Countdown state
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRedirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start auto-redirect countdown after 15 seconds of inactivity (if no submit)
  useEffect(() => {
    autoRedirectRef.current = setTimeout(() => {
      if (!submitted) {
        startCountdown();
      }
    }, 15000);

    return () => {
      if (autoRedirectRef.current) clearTimeout(autoRedirectRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [submitted]);

  const startCountdown = () => {
    if (countdown !== null) return; // Already counting
    setCountdown(3);
  };

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

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await apiSubmitExitInterview(userEmail, userName, reason.trim());
      setSubmitted(true);
      // Start countdown after submission
      setTimeout(() => startCountdown(), 2000);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-secondary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-lg w-full space-y-8">
        {/* Farewell icon */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/5 backdrop-blur-lg border border-white/10 mb-6">
            <span
              className="material-symbols-outlined text-4xl text-white/80"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              waving_hand
            </span>
          </div>
        </div>

        {/* Main card */}
        <div className="bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="p-8 pb-0 text-center space-y-3">
            <h1 className="text-3xl font-bold text-white tracking-tight font-headline">
              We're sorry to see you go{userName !== "friend" ? `, ${userName}` : ""}.
            </h1>
            <p className="text-white/60 text-sm leading-relaxed">
              Your account has been permanently deleted.
            </p>
          </div>

          {/* Messages */}
          <div className="px-8 py-6 space-y-4">
            <div className="flex items-start gap-3 p-4 bg-white/5 rounded-xl border border-white/5">
              <span className="material-symbols-outlined text-lg text-amber-400 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
                auto_awesome
              </span>
              <p className="text-sm text-white/70 leading-relaxed">
                <span className="text-white font-semibold">IntelliDraw keeps improving every week.</span>{" "}
                We're building the best flowchart, system design, architecture, and thought assistance possible with modern technology.
              </p>
            </div>

            <div className="flex items-start gap-3 p-4 bg-white/5 rounded-xl border border-white/5">
              <span className="material-symbols-outlined text-lg text-emerald-400 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>
                card_giftcard
              </span>
              <p className="text-sm text-white/70 leading-relaxed">
                <span className="text-white font-semibold">You're always welcome back.</span>{" "}
                When you're ready, return for a <span className="text-emerald-400 font-bold">free one-month trial</span> — no strings attached.
              </p>
            </div>
          </div>

          {/* Exit Interview */}
          <div className="px-8 pb-8 space-y-4">
            {!submitted ? (
              <>
                <div className="border-t border-white/10 pt-6">
                  <label className="text-sm font-semibold text-white/80 block mb-2">
                    Why did you leave? <span className="text-white/40 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="exit-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell us what we could do better..."
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:ring-2 focus:ring-primary/30 focus:border-transparent outline-none resize-none transition-all"
                  />
                </div>

                {submitError && (
                  <p className="text-sm text-red-400 font-medium">{submitError}</p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!reason.trim() || submitting}
                    className="flex-1 px-6 py-3 bg-white/10 text-white text-sm font-bold rounded-xl hover:bg-white/15 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-white/10"
                  >
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {submitting ? "progress_activity" : "send"}
                    </span>
                    {submitting ? "Submitting..." : "Submit Feedback"}
                  </button>
                </div>
              </>
            ) : (
              <div className="border-t border-white/10 pt-6 text-center space-y-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mb-2">
                  <span className="material-symbols-outlined text-2xl text-emerald-400" style={{ fontVariationSettings: "'FILL' 1" }}>
                    favorite
                  </span>
                </div>
                <p className="text-white font-bold text-lg">Thank you for your feedback ❤️</p>
                <p className="text-white/50 text-sm">Your response helps us improve IntelliDraw for everyone.</p>
              </div>
            )}
          </div>
        </div>

        {/* Countdown / Skip */}
        <div className="text-center space-y-3">
          {countdown !== null && countdown > 0 && (
            <p className="text-white/50 text-sm font-medium animate-pulse">
              Redirecting to IntelliDraw in{" "}
              <span className="text-white font-bold text-lg">{countdown}</span>...
            </p>
          )}
          <button
            onClick={handleSkip}
            className="text-white/40 hover:text-white/70 text-sm font-medium transition-colors inline-flex items-center gap-1"
          >
            Go to IntelliDraw now
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}
