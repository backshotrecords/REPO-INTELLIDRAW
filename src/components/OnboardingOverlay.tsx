import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGetOnboardingState, apiCompleteOnboarding } from "../lib/api";

interface OnboardingTutorial {
  id: string;
  step_order: number;
  gif_url: string | null;
  explanation_text: string;
  attached_page: string;
  content_updated_at: string | null;
}

interface OnboardingState {
  next_required: OnboardingTutorial | null;
  is_rewatch: boolean;
  total_tutorials: number;
  completed_count: number;
}

const PAGE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  canvas: "Canvas",
  "/settings": "Settings",
  "/skills": "Skills Marketplace",
  "/guild": "Guild Badges",
  "/admin": "Admin Dashboard",
};

export default function OnboardingOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [visible, setVisible] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const data = await apiGetOnboardingState();
      setState(data);
    } catch (err) {
      console.error("Failed to fetch onboarding state:", err);
      setState(null);
    }
  }, []);

  // Fetch state on mount and when route changes
  useEffect(() => {
    fetchState();
    setDismissed(false);
  }, [location.pathname, fetchState]);

  // Determine if current page matches the tutorial's attached page
  const currentPath = location.pathname;
  const tutorial = state?.next_required;

  const pageMatches = (() => {
    if (!tutorial) return false;
    const attached = tutorial.attached_page;
    if (attached === "canvas") {
      return currentPath.startsWith("/canvas/");
    }
    return currentPath === attached;
  })();

  // Show overlay when tutorial matches current page
  useEffect(() => {
    if (tutorial && pageMatches && !dismissed) {
      // Small delay for page to render first
      const timer = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [tutorial, pageMatches, dismissed]);

  const handleComplete = async () => {
    if (!tutorial || completing) return;
    setCompleting(true);
    try {
      await apiCompleteOnboarding(tutorial.id);
      setAnimatingOut(true);
      setTimeout(() => {
        setVisible(false);
        setAnimatingOut(false);
        setDismissed(false);
        fetchState(); // Check for next tutorial
      }, 400);
    } catch (err) {
      console.error("Failed to complete onboarding:", err);
    } finally {
      setCompleting(false);
    }
  };

  const handleDismiss = () => {
    setAnimatingOut(true);
    setTimeout(() => {
      setVisible(false);
      setAnimatingOut(false);
      setDismissed(true);
    }, 300);
  };

  // No tutorial or all caught up
  if (!tutorial || !state) return null;

  // Tutorial exists but for a different page — show notification banner
  if (!pageMatches && !dismissed) {
    const pageName = PAGE_LABELS[tutorial.attached_page] || tutorial.attached_page;
    const targetPath = tutorial.attached_page === "canvas" ? "/dashboard" : tutorial.attached_page;

    return (
      <div
        className="fixed top-0 left-0 right-0 z-[9999] flex justify-center pointer-events-none"
        style={{ paddingTop: "80px" }}
      >
        <div
          className="pointer-events-auto mx-4 max-w-lg w-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-2xl shadow-lg px-5 py-4 flex items-center gap-4 animate-[slideDown_0.4s_ease-out]"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <span
              className="material-symbols-outlined text-amber-600 text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {state.is_rewatch ? "refresh" : "school"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {state.is_rewatch ? "Updated tutorial available" : "Onboarding tutorial waiting"}
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Head to <button onClick={() => navigate(targetPath)} className="font-bold underline underline-offset-2 hover:text-amber-900 transition-colors">{pageName}</button> to continue
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded-lg transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>
    );
  }

  // Tutorial matches current page — show full overlay modal
  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${
        animatingOut ? "opacity-0 scale-95" : "opacity-100 scale-100"
      }`}
      style={{ animation: animatingOut ? undefined : "fadeInScale 0.4s ease-out" }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleDismiss}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-outline-variant/20">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/10 to-secondary-fixed/30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <span
                className="material-symbols-outlined text-primary text-lg"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {state.is_rewatch ? "refresh" : "school"}
              </span>
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">
                {state.is_rewatch ? "Tutorial Updated" : "Onboarding"}
              </p>
              <p className="text-[11px] text-on-surface-variant">
                Step {tutorial.step_order} of {state.total_tutorials}
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* GIF */}
        {tutorial.gif_url && (
          <div className="w-full bg-surface-container-low border-y border-outline-variant/10">
            <img
              src={tutorial.gif_url}
              alt="Tutorial demonstration"
              className="w-full max-h-72 object-contain"
            />
          </div>
        )}

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-sm text-on-surface leading-relaxed whitespace-pre-line">
            {tutorial.explanation_text}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide bg-secondary-fixed text-on-secondary-fixed-variant px-2 py-1 rounded-lg">
              {PAGE_LABELS[tutorial.attached_page] || tutorial.attached_page}
            </span>
            {state.is_rewatch && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-1 rounded-lg">
                Updated
              </span>
            )}
          </div>
          <button
            onClick={handleComplete}
            disabled={completing}
            className="bg-gradient-to-r from-primary to-primary/80 text-white font-bold text-sm px-6 py-3 rounded-xl hover:shadow-lg active:scale-95 transition-all duration-200 disabled:opacity-50 flex items-center gap-2"
          >
            <span
              className="material-symbols-outlined text-base"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {completing ? "progress_activity" : "check_circle"}
            </span>
            {completing ? "Saving..." : "Got it!"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-surface-container-high">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-500 rounded-full"
            style={{
              width: `${state.total_tutorials > 0
                ? Math.round((state.completed_count / state.total_tutorials) * 100)
                : 0}%`,
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes fadeInScale {
          0% { opacity: 0; transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes slideDown {
          0% { opacity: 0; transform: translateY(-20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
