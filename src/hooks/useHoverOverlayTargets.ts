import { type DependencyList, type RefObject, useCallback, useEffect, useRef, useState } from "react";

export interface HoverOverlayTarget<TData> {
  key: string;
  element: Element;
  data: TData;
}

interface UseHoverOverlayTargetsOptions<TData> {
  layerRef: RefObject<HTMLElement | null>;
  isInteractionSuppressed: boolean;
  scanTargets: (layerEl: HTMLElement) => HoverOverlayTarget<TData>[];
  rescanDeps: DependencyList;
  overlayInteractiveSelector?: string;
  idleMs?: number;
}

interface UseHoverOverlayTargetsResult<TData> {
  targets: HoverOverlayTarget<TData>[];
  visibleKey: string | null;
  showTarget: (key: string) => void;
}

/**
 * Owns the reusable lifecycle for DOM-anchored hover overlays:
 * target rescans, pointer listeners, native :hover sync, idle hiding,
 * mutation-driven Mermaid/SVG refreshes, and gesture suppression.
 */
export function useHoverOverlayTargets<TData>({
  layerRef,
  isInteractionSuppressed,
  scanTargets,
  rescanDeps,
  overlayInteractiveSelector = "[data-hover-overlay-control='true']",
  idleMs = 3000,
}: UseHoverOverlayTargetsOptions<TData>): UseHoverOverlayTargetsResult<TData> {
  const [targets, setTargets] = useState<HoverOverlayTarget<TData>[]>([]);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const hideTarget = useCallback(() => {
    setVisibleKey(null);
    clearIdleTimer();
  }, [clearIdleTimer]);

  const showTarget = useCallback((key: string) => {
    if (isInteractionSuppressed) return;

    setVisibleKey(key);
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      setVisibleKey(null);
      idleTimerRef.current = null;
    }, idleMs);
  }, [clearIdleTimer, idleMs, isInteractionSuppressed]);

  const rescan = useCallback(() => {
    const layerEl = layerRef.current;
    if (!layerEl) {
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;
      setTargets([]);
      hideTarget();
      return;
    }

    const nextTargets = scanTargets(layerEl);

    listenerCleanupRef.current?.();
    const cleanups = nextTargets.map((target) => {
      const handlePointerEnter = () => showTarget(target.key);
      const handlePointerMove = () => showTarget(target.key);
      const handlePointerLeave = (event: Event) => {
        const nextTarget = (event as PointerEvent).relatedTarget;
        if (nextTarget instanceof Element && nextTarget.closest(overlayInteractiveSelector)) {
          return;
        }
        hideTarget();
      };

      target.element.addEventListener("pointerenter", handlePointerEnter);
      target.element.addEventListener("pointermove", handlePointerMove);
      target.element.addEventListener("pointerleave", handlePointerLeave);

      return () => {
        target.element.removeEventListener("pointerenter", handlePointerEnter);
        target.element.removeEventListener("pointermove", handlePointerMove);
        target.element.removeEventListener("pointerleave", handlePointerLeave);
      };
    });

    listenerCleanupRef.current = () => cleanups.forEach(cleanup => cleanup());
    setTargets(nextTargets);

    if (nextTargets.length === 0) {
      hideTarget();
      return;
    }

    const hoveredTarget = nextTargets.find(target => target.element.matches(":hover"));
    if (hoveredTarget && !isInteractionSuppressed) {
      showTarget(hoveredTarget.key);
    }
  }, [hideTarget, isInteractionSuppressed, layerRef, overlayInteractiveSelector, scanTargets, showTarget]);

  useEffect(() => {
    const raf = requestAnimationFrame(rescan);
    const timer = setTimeout(rescan, 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescan, ...rescanDeps]);

  useEffect(() => {
    const layerEl = layerRef.current;
    if (!layerEl) return;

    const observer = new MutationObserver(() => {
      requestAnimationFrame(rescan);
    });

    observer.observe(layerEl, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [layerRef, rescan]);

  useEffect(() => {
    if (isInteractionSuppressed) {
      hideTarget();
      return;
    }

    rescan();
  }, [hideTarget, isInteractionSuppressed, rescan]);

  useEffect(() => {
    return () => {
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;
      clearIdleTimer();
    };
  }, [clearIdleTimer]);

  return { targets, visibleKey, showTarget };
}
