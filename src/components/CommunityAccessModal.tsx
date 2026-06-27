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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollbarStartY = useRef(0);
  const scrollbarStartScrollTop = useRef(0);
  const [scrollState, setScrollState] = useState({ height: 0, top: 0, show: false });
  const [scrollbarDragging, setScrollbarDragging] = useState(false);

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

  const updateScrollbar = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight) {
      setScrollState(prev => ({ ...prev, height: 0, top: 0 }));
      return;
    }

    const trackHeight = clientHeight - 16;
    const height = Math.max((clientHeight / scrollHeight) * trackHeight, 30);
    const maxScrollTop = scrollHeight - clientHeight;
    const maxThumbTop = trackHeight - height;
    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
    setScrollState(prev => ({ ...prev, height, top }));
  }, []);

  const showScrollbarTemporarily = useCallback(() => {
    setScrollState(prev => ({ ...prev, show: true }));
    if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
    scrollbarTimerRef.current = setTimeout(() => {
      setScrollState(prev => ({ ...prev, show: false }));
    }, 2000);
  }, []);

  const handleContentScroll = () => {
    updateScrollbar();
    showScrollbarTemporarily();
  };

  const handleContentMouseMove = () => {
    if (!scrollbarDragging) showScrollbarTemporarily();
  };

  const handleScrollbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setScrollbarDragging(true);
    scrollbarStartY.current = event.clientY;
    if (scrollContainerRef.current) {
      scrollbarStartScrollTop.current = scrollContainerRef.current.scrollTop;
    }
    document.body.style.userSelect = "none";
  };

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

  useEffect(() => {
    const frame = requestAnimationFrame(updateScrollbar);
    window.addEventListener("resize", updateScrollbar);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateScrollbar);
    };
  }, [cardCopy, open, requestError, requestStatus, updateScrollbar]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!scrollbarDragging) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const deltaY = event.clientY - scrollbarStartY.current;
      const trackHeight = container.clientHeight - 16;
      const height = Math.max((container.clientHeight / container.scrollHeight) * trackHeight, 30);
      const maxThumbTop = trackHeight - height;
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      const scrollDelta = maxThumbTop > 0 ? deltaY * (maxScrollTop / maxThumbTop) : 0;
      container.scrollTop = scrollbarStartScrollTop.current + scrollDelta;
    };

    const handlePointerUp = () => {
      if (!scrollbarDragging) return;
      setScrollbarDragging(false);
      document.body.style.userSelect = "";
      showScrollbarTemporarily();
    };

    if (scrollbarDragging) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [scrollbarDragging, showScrollbarTemporarily]);

  useEffect(() => {
    return () => {
      if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
      document.body.style.userSelect = "";
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <div className="relative flex h-full w-full flex-col overflow-hidden border-outline-variant/70 bg-white shadow-2xl sm:h-[calc(100vh-3rem)] sm:max-w-[560px] sm:rounded-[28px] sm:border">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-variant"
          aria-label="Close community access"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="relative flex min-h-0 flex-1">
          <div
            ref={scrollContainerRef}
            onScroll={handleContentScroll}
            onMouseMove={handleContentMouseMove}
            className="no-scrollbar flex h-full w-full flex-col items-center overflow-y-auto px-6 pb-8 pt-8 text-center sm:px-10"
          >
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
          </div>

          {scrollState.height > 0 && (
            <div
              className={`absolute bottom-2 right-1 top-2 z-10 hidden w-6 justify-end transition-opacity duration-500 group/scroll sm:flex ${
                scrollState.show || scrollbarDragging ? "opacity-100" : "opacity-0"
              }`}
              onMouseEnter={() => {
                if (scrollbarTimerRef.current) clearTimeout(scrollbarTimerRef.current);
                setScrollState(prev => ({ ...prev, show: true }));
              }}
              onMouseLeave={() => {
                if (!scrollbarDragging) showScrollbarTemporarily();
              }}
            >
              <div className="relative h-full w-full">
                <div
                  onPointerDown={handleScrollbarPointerDown}
                  className={`absolute right-0 rounded-full bg-gray-300/80 transition-[width,background-color] duration-300 ease-out group-hover/scroll:bg-gray-400/90 ${
                    scrollbarDragging ? "w-2.5 bg-gray-400/90" : "w-1.5 group-hover/scroll:w-2.5"
                  }`}
                  style={{
                    height: `${scrollState.height}px`,
                    transform: `translateY(${scrollState.top}px)`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-outline-variant/40 bg-white px-6 pb-6 pt-5 shadow-[0_-14px_32px_rgba(9,15,32,0.08)] sm:border-t-0 sm:px-10 sm:pb-8 sm:pt-0 sm:shadow-none">
          <div
            ref={trackRef}
            className={`relative mx-auto h-20 w-full max-w-[460px] overflow-hidden rounded-full shadow-xl transition-colors ${
              completed ? "bg-[#29d265]" : "bg-[#090f20]"
            }`}
          >
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-24 text-base font-extrabold text-white sm:text-lg">
              {completed ? (
                "Opening WhatsApp..."
              ) : (
                <>
                  <span className="sm:hidden">Slide to join</span>
                  <span className="hidden sm:inline">{cardCopy.slideLabel}</span>
                </>
              )}
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
