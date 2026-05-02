import { useEffect, useRef, useState } from "react";

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
 * next to a clicked Mermaid SVG node. Positioned in fixed screen-space (zoom-independent).
 *
 * The actions array makes this extensible: add new entries for edit, delete, etc.
 * Currently renders a single "+" button; future work can fan them into a radial layout.
 */
export default function NodeActionOverlay({ nodeRect, visible, actions }: NodeActionOverlayProps) {
  const [animateIn, setAnimateIn] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Trigger the spring animation after mount
  useEffect(() => {
    if (visible && nodeRect) {
      // Small delay to let the DOM paint first, then trigger the CSS transition
      const raf = requestAnimationFrame(() => {
        setAnimateIn(true);
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setAnimateIn(false);
    }
  }, [visible, nodeRect]);

  if (!visible || !nodeRect) return null;

  // Calculate position — place the buttons to the right of the node by default
  const gap = 12; // px between node edge and button
  const btnSize = 44; // total hit area (36px visual + 4px padding each side)

  // Edge detection: flip to left side if node is too close to right viewport edge
  const viewportWidth = window.innerWidth;
  const spaceRight = viewportWidth - nodeRect.right;
  const placeLeft = spaceRight < (btnSize + gap + 20); // 20px safety margin

  // Vertical center relative to the node
  const top = nodeRect.top + nodeRect.height / 2;

  // Horizontal position
  const left = placeLeft
    ? nodeRect.left - gap - btnSize / 2
    : nodeRect.right + gap + btnSize / 2;

  return (
    <div
      ref={overlayRef}
      className="node-action-overlay"
      style={{
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
      }}
    >
      {actions.map((action, index) => {
        // For future radial layout, offset each button by angle.
        // Currently all buttons stack vertically with 48px spacing.
        const verticalOffset = index * 48;

        return (
          <div
            key={action.id}
            className={`node-action-btn-wrapper ${animateIn ? "node-action-visible" : ""}`}
            style={{
              left: `${left}px`,
              top: `${top + verticalOffset}px`,
              transform: animateIn
                ? "translate(-50%, -50%) scale(1) rotate(0deg)"
                : "translate(-50%, -50%) scale(0.5) rotate(-90deg)",
              opacity: animateIn ? 1 : 0,
              // Stagger each button slightly for a cascading effect
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
    </div>
  );
}
