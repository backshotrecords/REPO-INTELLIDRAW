import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { SubscriptionPlanId } from "../types";
import PlanBadge from "./PlanBadge";

interface UpgradePlanModalProps {
  open: boolean;
  featureLabel: string;
  requiredPlan: SubscriptionPlanId | null;
  planName: string;
  onClose: () => void;
  onUpgrade: () => void;
}

const THUMB_WIDTH = 84;
const SLIDE_COMPLETE_RATIO = 0.72;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function UpgradePlanModal({
  open,
  featureLabel,
  requiredPlan,
  planName,
  onClose,
  onUpgrade,
}: UpgradePlanModalProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartOffset, setDragStartOffset] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!open) {
      setDragging(false);
      setDragX(0);
      setCompleted(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const maxDrag = useCallback(() => {
    const width = trackRef.current?.getBoundingClientRect().width || 0;
    return Math.max(0, width - THUMB_WIDTH - 8);
  }, []);

  const completeUpgrade = useCallback(() => {
    if (completed) return;
    setCompleted(true);
    setDragX(maxDrag());
    onUpgrade();
  }, [completed, maxDrag, onUpgrade]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (completed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragStartX(event.clientX);
    setDragStartOffset(dragX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging || completed) return;
    setDragX(clamp(dragStartOffset + event.clientX - dragStartX, 0, maxDrag()));
  };

  const handlePointerUp = () => {
    if (!dragging || completed) return;
    setDragging(false);
    const limit = maxDrag();
    if (limit > 0 && dragX / limit >= SLIDE_COMPLETE_RATIO) {
      completeUpgrade();
      return;
    }
    setDragX(0);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    completeUpgrade();
  };

  const copy = useMemo(() => {
    const plan = planName || "a higher plan";
    return {
      headline: `Upgrade to ${plan}`,
      body: `${featureLabel} is included in ${plan}. Upgrade to unlock this feature and the rest of the ${plan} toolkit.`,
      slideLabel: `Slide to upgrade to ${plan}`,
    };
  }, [featureLabel, planName]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-stretch justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <div className="relative flex h-full w-full flex-col overflow-hidden border-outline-variant/70 bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100vh-3rem)] sm:max-w-[560px] sm:rounded-[28px] sm:border">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-variant"
          aria-label="Close upgrade prompt"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-8 pt-8 text-center sm:px-10">
          <div className="mb-7 flex items-center gap-3 text-on-surface">
            <span className="material-symbols-outlined text-[32px]">draw</span>
            <span className="font-manrope text-[28px] font-extrabold tracking-normal">IntelliDraw</span>
          </div>

          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-outline-variant/30 bg-surface-container-lowest px-4 py-2 text-sm font-extrabold uppercase tracking-normal text-on-surface">
            <span className="material-symbols-outlined text-[18px]">workspace_premium</span>
            {requiredPlan && <PlanBadge planId={requiredPlan} />}
          </div>

          <h2 className="mb-4 max-w-[460px] font-headline text-[42px] font-extrabold leading-[1.05] tracking-normal text-[#090f20] sm:text-[54px]">
            {copy.headline}
          </h2>
          <p className="mx-auto mb-8 max-w-[430px] text-[16px] font-semibold leading-7 tracking-normal text-on-surface-variant sm:text-[18px]">
            {copy.body}
          </p>

          <div className="mb-5 grid w-full max-w-[420px] gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 text-left">
            <div className="flex items-center gap-3 text-sm font-bold text-on-surface">
              <span className="material-symbols-outlined text-primary">lock_open</span>
              Unlock {featureLabel}
            </div>
            <div className="flex items-center gap-3 text-sm font-bold text-on-surface">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              Keep building without plan gates
            </div>
            <div className="flex items-center gap-3 text-sm font-bold text-on-surface">
              <span className="material-symbols-outlined text-primary">support_agent</span>
              Contact us to switch your plan
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-outline-variant/40 bg-white px-6 pb-6 pt-5 shadow-[0_-14px_32px_rgba(9,15,32,0.08)] sm:border-t-0 sm:px-10 sm:pb-8 sm:pt-0 sm:shadow-none">
          <div
            ref={trackRef}
            className={`relative mx-auto h-20 w-full max-w-[460px] overflow-hidden rounded-full shadow-xl transition-colors ${
              completed ? "bg-[#29d265]" : "bg-[#090f20]"
            }`}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-24 text-base font-extrabold text-white sm:text-lg">
              {completed ? "Opening upgrade contact..." : copy.slideLabel}
            </div>
            <button
              type="button"
              className="absolute left-1 top-1 flex h-[72px] w-[84px] touch-none items-center justify-center rounded-full bg-white text-[#29d265] shadow-lg transition-transform focus:outline-none focus:ring-4 focus:ring-[#29d265]/30"
              style={{ transform: `translateX(${completed ? maxDrag() : dragX}px)` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown}
              aria-label={copy.slideLabel}
            >
              <span className="material-symbols-outlined text-[34px]">arrow_forward</span>
            </button>
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm font-extrabold uppercase tracking-normal text-outline">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            Secure upgrade request
          </div>
        </div>
      </div>
    </div>
  );
}
