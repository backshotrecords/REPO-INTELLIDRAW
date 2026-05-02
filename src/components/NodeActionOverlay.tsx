import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Extensible action definition — add new entries here for future radial menu items.
 */
export interface NodeAction {
  id: string;
  icon: string;          // Material Symbols icon name
  label: string;         // Tooltip text
  onClick: () => void;
}

interface NodeActionOverlayProps {
  /** Bounding rect of the active node in viewport coordinates */
  nodeRect: DOMRect | null;
  /** Whether the overlay is visible */
  visible: boolean;
  /** List of action buttons to render (extensible) */
  actions: NodeAction[];
}

/**
 * NodeActionOverlay — floating HTML overlay that renders contextual action buttons
 * next to a clicked Mermaid SVG node. Rendered via Portal into document.body.
 *
 * Supports roll-in and roll-out animations with lateral movement + spin.
 */
export default function NodeActionOverlay({ nodeRect, visible, actions }: NodeActionOverlayProps) {
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "exiting">("hidden");
  const lastRectRef = useRef<DOMRect | null>(null);
  const lastActionsRef = useRef<NodeAction[]>([]);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the last valid rect and actions for exit animations
  if (nodeRect) {
    lastRectRef.current = nodeRect;
  }
  if (actions.length > 0) {
    lastActionsRef.current = actions;
  }

  useEffect(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (visible && nodeRect) {
      // Animate in: hidden → entering → (paint) → visible
      // Double-rAF ensures the browser paints the "entering" state before
      // we apply "visible", giving the CSS transition something to animate from.
      setPhase("entering");
      const raf = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          setPhase("visible");
        });
        // Store for cleanup
        (cleanup as any).raf2 = raf2;
      });
      const cleanup: any = { raf };
      return () => {
        cancelAnimationFrame(cleanup.raf);
        if (cleanup.raf2) cancelAnimationFrame(cleanup.raf2);
      };
    } else if (phase === "visible" || phase === "entering") {
      // Animate out: ensure the browser paints the "visible" state,
      // then apply "exiting" so the CSS transition has a starting point.
      const exitRaf = requestAnimationFrame(() => {
        setPhase("exiting");
      });
      exitTimerRef.current = setTimeout(() => {
        setPhase("hidden");
        exitTimerRef.current = null;
      }, 500); // transition duration + buffer
      return () => cancelAnimationFrame(exitRaf);
    }
  }, [visible, nodeRect]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  if (phase === "hidden") return null;

  // Use last known rect for exit animation positioning
  const rect = nodeRect || lastRectRef.current;
  if (!rect) return null;

  const gap = 12;
  const btnSize = 44;
  const rollDistance = 10; // px lateral shift for roll effect

  const viewportWidth = window.innerWidth;
  const spaceRight = viewportWidth - rect.right;
  const placeLeft = spaceRight < (btnSize + gap + 20);

  const top = rect.top + rect.height / 2;
  const baseLeft = placeLeft
    ? rect.left - gap - btnSize / 2
    : rect.right + gap + btnSize / 2;

  const isIn = phase === "visible";
  const isExiting = phase === "exiting";

  // Use last known actions during exit so buttons exist to animate out
  const resolvedActions = actions.length > 0 ? actions : lastActionsRef.current;

  const overlay = (
    <>
      {resolvedActions.map((action, index) => {
        const verticalOffset = index * 48;

        let transform: string;
        let opacity: number;

        if (isIn) {
          // Fully visible — at rest position
          transform = `translate(-50%, -50%) translateX(0px) scale(1) rotate(0deg)`;
          opacity = 1;
        } else if (isExiting) {
          // Rolling back out — shift left, spin reverse, fade
          transform = `translate(-50%, -50%) translateX(${placeLeft ? rollDistance : -rollDistance}px) scale(0.5) rotate(${placeLeft ? 90 : -90}deg)`;
          opacity = 0;
        } else {
          // Entering — start offset, small, rotated
          transform = `translate(-50%, -50%) translateX(${placeLeft ? rollDistance : -rollDistance}px) scale(0.5) rotate(${placeLeft ? 90 : -90}deg)`;
          opacity = 0;
        }

        return (
          <div
            key={action.id}
            className="node-action-btn-wrapper"
            style={{
              position: "fixed",
              zIndex: 9999,
              left: `${baseLeft}px`,
              top: `${top + verticalOffset}px`,
              transform,
              opacity,
              transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease",
              transitionDelay: isExiting ? "0ms" : `${index * 50}ms`,
              pointerEvents: isIn ? "auto" : "none",
            }}
          >
            <button
              className="node-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                action.onClick();
              }}
              title={action.label}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20, fontVariationSettings: "'FILL' 1, 'wght' 500" }}
              >
                {action.icon}
              </span>
            </button>
            <div className={`node-action-tooltip ${isIn ? "node-action-tooltip-auto" : ""}`}>{action.label}</div>
          </div>
        );
      })}
    </>
  );

  return createPortal(overlay, document.body);
}
