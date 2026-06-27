import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ApiKeyRequestStatus, CommunityAccessConfig, CommunityAccessSource } from "../contexts/CommunityAccessContext";

interface CommunityAccessModalProps {
  open: boolean;
  config: CommunityAccessConfig;
  hasApiKey: boolean;
  requestStatus: ApiKeyRequestStatus;
  requestError: string | null;
  requesting: boolean;
  source: CommunityAccessSource;
  onClose: () => void;
  onJoin: () => Promise<void>;
}

const THUMB_WIDTH = 84;
const SLIDE_COMPLETE_RATIO = 0.72;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function CommunityAccessModal({
  open,
  config,
  hasApiKey,
  requestStatus,
  requestError,
  requesting,
  source,
  onClose,
  onJoin,
}: CommunityAccessModalProps) {
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

  const maxDrag = useCallback(() => {
    const width = trackRef.current?.getBoundingClientRect().width || 0;
    return Math.max(0, width - THUMB_WIDTH - 8);
  }, []);

  const completeJoin = useCallback(async () => {
    if (completed || requesting) return;
    setCompleted(true);
    setDragX(maxDrag());
    try {
      await onJoin();
    } catch {
      setCompleted(false);
      setDragX(0);
    }
  }, [completed, maxDrag, onJoin, requesting]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (completed || requesting) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragStartX(event.clientX);
    setDragStartOffset(dragX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging || completed || requesting) return;
    const nextX = clamp(dragStartOffset + event.clientX - dragStartX, 0, maxDrag());
    setDragX(nextX);
  };

  const handlePointerUp = async () => {
    if (!dragging || completed || requesting) return;
    setDragging(false);
    const limit = maxDrag();
    if (limit > 0 && dragX / limit >= SLIDE_COMPLETE_RATIO) {
      await completeJoin();
      return;
    }
    setDragX(0);
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    await completeJoin();
  };

  const cardCopy = useMemo(() => {
    if (hasApiKey) {
      return {
        headline: "Get Help in the Community",
        body: "Join WhatsApp for setup help, feature updates, and canvas ideas from other builders.",
        slideLabel: "Slide to join WhatsApp",
        ariaLabel: "Join WhatsApp community",
      };
    }
    if (source === "help" || source === "contact") {
      return {
        headline: "Get Help From the Community",
        body: "Join the WhatsApp community of creators, devs, and admins for help, setup questions, and updates.",
        slideLabel: "Slide to join WhatsApp",
        ariaLabel: "Join WhatsApp community for help",
      };
    }
    if (requestStatus === "requested") {
      return {
        headline: "API Key Request Sent",
        body: "Your request is in the admin queue. Join WhatsApp for updates and help while it gets handled.",
        slideLabel: "Slide to open WhatsApp",
        ariaLabel: "Open WhatsApp community",
      };
    }
    return {
      headline: "Get Your Access Key Now",
      body: "Join WhatsApp to request access from an admin and get other help.",
      slideLabel: "Slide to request access",
      ariaLabel: "Request API key access through WhatsApp",
    };
  }, [hasApiKey, requestStatus, source]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="relative w-full max-w-[560px] rounded-[28px] border border-outline-variant/70 bg-white px-6 py-8 shadow-2xl sm:px-10">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-variant"
          aria-label="Close community access"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="mb-7 flex items-center gap-3 text-on-surface">
            <span className="material-symbols-outlined text-[32px]">draw</span>
            <span className="font-manrope text-[28px] font-extrabold tracking-normal">IntelliDraw</span>
          </div>

          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b8f1cc] bg-[#effdf4] px-4 py-2 text-sm font-extrabold uppercase tracking-normal text-[#04a246]">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            Official Group
          </div>

          <h2 className="mb-4 max-w-[460px] font-headline text-[42px] font-extrabold leading-[1.05] tracking-normal text-[#090f20] sm:text-[54px]">
            {cardCopy.headline}
          </h2>
          <p className="mx-auto mb-9 max-w-[430px] text-[16px] font-semibold leading-7 tracking-normal text-on-surface-variant sm:text-[18px]">
            {cardCopy.body}
          </p>

          <div className="mb-5 flex items-center justify-center">
            <div className="flex -space-x-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[#eef3fb] shadow-sm">
                <span className="material-symbols-outlined text-[30px] text-[#0b1020]">person</span>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[#eef0ff] shadow-sm">
                <span className="material-symbols-outlined text-[30px] text-[#0b1020]">face</span>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[#fff1bf] shadow-sm">
                <span className="material-symbols-outlined text-[30px] text-[#0b1020]">person_4</span>
              </div>
              <div className="flex h-14 min-w-14 items-center justify-center rounded-full border-4 border-white bg-white px-4 text-base font-extrabold text-[#0b1020] shadow-lg">
                {config.memberCountLabel}
              </div>
            </div>
          </div>
          <p className="mb-9 text-sm font-bold text-on-surface-variant">{config.memberCopy}</p>

          <div
            ref={trackRef}
            className={`relative h-20 w-full max-w-[460px] overflow-hidden rounded-full shadow-xl transition-colors ${
              completed ? "bg-[#29d265]" : "bg-[#090f20]"
            }`}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-24 text-base font-extrabold text-white sm:text-lg">
              {completed ? "Opening WhatsApp..." : cardCopy.slideLabel}
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
              aria-label={cardCopy.ariaLabel}
              disabled={requesting}
            >
              <span className="material-symbols-outlined text-[34px]">arrow_forward</span>
            </button>
          </div>

          {requestStatus === "requested" && !hasApiKey && (
            <p className="mt-5 rounded-full bg-[#effdf4] px-4 py-2 text-sm font-bold text-[#047a35]">
              Access key request sent
            </p>
          )}
          {requestError && (
            <p className="mt-5 max-w-[420px] rounded-xl bg-error-container px-4 py-3 text-sm font-semibold text-on-error-container">
              {requestError}
            </p>
          )}

          <div className="mt-8 flex items-center gap-2 text-sm font-extrabold uppercase tracking-normal text-outline">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            Secure community link
          </div>
        </div>
      </div>
    </div>
  );
}
