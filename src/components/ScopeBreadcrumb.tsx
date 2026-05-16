import { useRef, useEffect, useState } from "react";

interface BreadcrumbSegment {
  id: string;
  label: string;
}

interface ScopeBreadcrumbProps {
  /** Array of { id, label } from root scope to current scope */
  scopePath: BreadcrumbSegment[];
  /** Navigate to a specific scope (null = root) */
  onNavigate: (scopeId: string | null) => void;
}

/**
 * ScopeBreadcrumb — horizontal breadcrumb bar for compound-node scope navigation.
 * Uses sticky side-scroll arrows (like the node selection tray) for deep nesting.
 * Only visible when inside a subgraph (not at root).
 */
export default function ScopeBreadcrumb({ scopePath, onNavigate }: ScopeBreadcrumbProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  // Auto-scroll to the end when path changes
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    }
  }, [scopePath]);

  // Track scroll position for arrow visibility
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const checkScroll = () => {
      setShowLeftArrow(el.scrollLeft > 4);
      setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", checkScroll);
      ro.disconnect();
    };
  }, [scopePath]);

  if (scopePath.length === 0) return null;

  return (
    <div className="scope-breadcrumb-wrapper">
      {/* Left scroll arrow */}
      {showLeftArrow && (
        <button
          className="scope-breadcrumb-arrow scope-breadcrumb-arrow-left"
          onClick={() => scrollRef.current?.scrollBy({ left: -120, behavior: "smooth" })}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_left</span>
        </button>
      )}

      <div ref={scrollRef} className="scope-breadcrumb-scroll">
        {/* Root segment */}
        <button
          className="scope-breadcrumb-segment scope-breadcrumb-root"
          onClick={() => onNavigate(null)}
          title="Back to root"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
          >
            home
          </span>
          <span>Root</span>
        </button>

        {/* Path segments */}
        {scopePath.map((seg, i) => {
          const isLast = i === scopePath.length - 1;
          return (
            <div key={seg.id} className="scope-breadcrumb-item">
              <span className="scope-breadcrumb-chevron">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
              </span>
              <button
                className={`scope-breadcrumb-segment ${isLast ? "scope-breadcrumb-active" : ""}`}
                onClick={() => {
                  if (!isLast) onNavigate(seg.id);
                }}
                disabled={isLast}
                title={seg.label}
              >
                {!isLast && (
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>folder_open</span>
                )}
                {isLast && (
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}
                  >
                    radio_button_checked
                  </span>
                )}
                <span className="scope-breadcrumb-label">
                  {seg.label.length > 24 ? seg.label.slice(0, 21) + "..." : seg.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Right scroll arrow */}
      {showRightArrow && (
        <button
          className="scope-breadcrumb-arrow scope-breadcrumb-arrow-right"
          onClick={() => scrollRef.current?.scrollBy({ left: 120, behavior: "smooth" })}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
        </button>
      )}
    </div>
  );
}
