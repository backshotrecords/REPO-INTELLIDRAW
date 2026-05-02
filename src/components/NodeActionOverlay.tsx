import { useEffect, useState } from "react";
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
 * next to a clicked Mermaid SVG node. Rendered via Portal into document.body to
 * escape any ancestor overflow/transform containment issues.
 *
 * The actions array makes this extensible: add new entries for edit, delete, etc.
 * Currently renders a single "+" button; future work can fan them into a radial layout.
 */
export default function NodeActionOverlay({ nodeRect, visible, actions }: NodeActionOverlayProps) {
  const [animateIn, setAnimateIn] = useState(false);

  // Trigger the spring animation after mount
  useEffect(() => {
    if (visible && nodeRect) {
      const raf = requestAnimationFrame(() => {
        setAnimateIn(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setAnimateIn(false);
    }
  }, [visible, nodeRect]);

  if (!visible || !nodeRect) return null;

  // Calculate position — place the button to the right of the node by default
  const gap = 12;
  const btnSize = 44;

  const viewportWidth = window.innerWidth;
  const spaceRight = viewportWidth - nodeRect.right;
  const placeLeft = spaceRight < (btnSize + gap + 20);

  const top = nodeRect.top + nodeRect.height / 2;
  const left = placeLeft
    ? nodeRect.left - gap - btnSize / 2
    : nodeRect.right + gap + btnSize / 2;

  const overlay = (
    <>
      {actions.map((action, index) => {
        const verticalOffset = index * 48;

        return (
          <div
            key={action.id}
            className={`node-action-btn-wrapper ${animateIn ? "node-action-visible" : ""}`}
            style={{
              position: "fixed",
              zIndex: 9999,
              left: `${left}px`,
              top: `${top + verticalOffset}px`,
              transform: animateIn
                ? "translate(-50%, -50%) scale(1) rotate(0deg)"
                : "translate(-50%, -50%) scale(0.5) rotate(-90deg)",
              opacity: animateIn ? 1 : 0,
              transitionDelay: `${index * 50}ms`,
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
            <div className="node-action-tooltip">{action.label}</div>
          </div>
        );
      })}
    </>
  );

  // Portal into document.body to escape overflow:hidden and transform containment
  return createPortal(overlay, document.body);
}
