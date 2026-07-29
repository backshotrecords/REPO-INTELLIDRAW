import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useEntitlements } from "../hooks/useEntitlements";
import { useUpgradePrompt } from "../contexts/UpgradePromptContext";
import VoiceMicButton from "./VoiceMicButton";
import PlanBadge from "./PlanBadge";

interface MobileCanvasWelcomeProps {
  onMinimize: () => void;
  onSubmit: (prompt: string) => Promise<void>;
}

export default function MobileCanvasWelcome({ onMinimize, onSubmit }: MobileCanvasWelcomeProps) {
  const { user } = useAuth();
  const { hasFeature, getRequiredPlan, getPlanName } = useEntitlements();
  const { openUpgradePrompt } = useUpgradePrompt();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canCreateCanvas = hasFeature("canvas.create");
  const canUseChat = hasFeature("canvas.ai_chat");
  const canUseVoice = hasFeature("voice.dictation");
  const displayName = user?.displayName?.trim() || "there";

  const requiredPlanMessage = (featureKey: string, label: string) => {
    const plan = getRequiredPlan(featureKey);
    return plan && plan !== "free"
      ? `${label} requires ${getPlanName(plan)}.`
      : `${label} is not available on your current plan.`;
  };

  const showUpgrade = (featureKey: string, featureLabel: string) => {
    openUpgradePrompt({
      featureKey,
      featureLabel,
      requiredPlan: getRequiredPlan(featureKey),
    });
  };

  const submit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || submitting) return;
    if (!canCreateCanvas) {
      showUpgrade("canvas.create", "Creating canvases");
      setError(requiredPlanMessage("canvas.create", "Creating canvases"));
      return;
    }
    if (!canUseChat) {
      showUpgrade("canvas.ai_chat", "AI canvas chat");
      setError(requiredPlanMessage("canvas.ai_chat", "AI canvas chat"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(trimmedPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create canvas");
      setSubmitting(false);
    }
  };

  return (
    <main className="mobile-canvas-welcome" aria-label="Quick Launch">
      <div className="mobile-canvas-welcome-grid" aria-hidden="true" />
      <header className="mobile-canvas-welcome-header">
        <span className="mobile-canvas-welcome-canvas-title">
          <span className="material-symbols-outlined">draw</span>
          Untitled Canvas
        </span>
        <button
          type="button"
          className="mobile-canvas-welcome-minimize"
          onClick={onMinimize}
          disabled={submitting}
          aria-label="Minimize Quick Launch and return to dashboard"
          title="Return to dashboard"
        >
          <span className="material-symbols-outlined">keyboard_arrow_down</span>
        </button>
      </header>

      <section className="mobile-canvas-welcome-content">
        <div className="mobile-canvas-welcome-brand">
          <span className="mobile-canvas-welcome-logo">
            <span className="material-symbols-outlined fill">draw</span>
          </span>
          <h1>IntelliDraw</h1>
          <p>Hey {displayName}, what’s the plan today?</p>
        </div>

        <div className="mobile-canvas-welcome-voice">
          <div
            onClickCapture={(event) => {
              if (canUseVoice) return;
              event.preventDefault();
              event.stopPropagation();
              showUpgrade("voice.dictation", "Voice input");
              setError(requiredPlanMessage("voice.dictation", "Voice input"));
            }}
          >
            <VoiceMicButton
              variant="welcome"
              canvasId={null}
              allowMeetingMode={false}
              inputBarHeight={112}
              disabled={submitting || !canUseVoice}
              onTranscript={(text) => {
                setPrompt((current) => current.trim() ? `${current.trim()} ${text}` : text);
                setError("");
              }}
            />
          </div>
          <span>{canUseVoice ? "Tap to talk" : "Voice input is locked"}</span>
          {!canUseVoice && <PlanBadge planId={getRequiredPlan("voice.dictation")} />}
        </div>
      </section>

      <div className="mobile-canvas-welcome-composer-area">
        {error && (
          <div className="mobile-canvas-welcome-error" role="alert">
            <span className="material-symbols-outlined">info</span>
            <span>{error}</span>
          </div>
        )}
        <div className="mobile-canvas-welcome-composer">
          <textarea
            rows={1}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              void submit();
            }}
            placeholder={canUseChat ? "Or describe your flowchart…" : requiredPlanMessage("canvas.ai_chat", "AI canvas chat")}
            disabled={submitting}
            aria-label="Describe your flowchart"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!prompt.trim() || submitting}
            aria-label="Create canvas from prompt"
            title="Create canvas"
          >
            {submitting ? (
              <span className="spinner border-white/30 border-t-white" />
            ) : (
              <span className="material-symbols-outlined">arrow_upward</span>
            )}
          </button>
        </div>
        <small>{submitting ? "Creating your canvas…" : "Your canvas is created when you send"}</small>
      </div>
    </main>
  );
}
