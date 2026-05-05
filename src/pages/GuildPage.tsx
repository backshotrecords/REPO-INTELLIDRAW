import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { apiListCanvases } from "../lib/api";
import "./GuildPage.css";

/* ── Level Definitions ──────────────────────────────────────── */

const LEVEL_THRESHOLDS = [0, 1, 3, 10, 50];

const levels = [
  {
    id: 1,
    title: "Initiate",
    subtitle: "AI Hobbyist · L1",
    shortDesc: "A single point of awareness.",
    fullDesc:
      "You have entered the system. At this stage, thought is still singular, focused, and undefined. This is the beginning of structured intelligence, where curiosity becomes intention.",
    threshold: LEVEL_THRESHOLDS[0],
    symbol: (
      <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
        <circle cx="110" cy="110" r="80" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="50" stroke="black" strokeWidth="2" />
        <circle cx="110" cy="110" r="6" fill="black" />
      </svg>
    ),
  },
  {
    id: 2,
    title: "Practitioner",
    subtitle: "AI Builder · L2",
    shortDesc: "Connections begin to form.",
    fullDesc:
      "You move beyond isolated thought. Ideas now connect, forming the first stable system. You are no longer observing, you are building relationships between concepts.",
    threshold: LEVEL_THRESHOLDS[1],
    symbol: (
      <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
        <circle cx="110" cy="110" r="80" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="55" stroke="black" strokeWidth="2" />
        <polygon points="110,75 145,135 75,135" stroke="black" strokeWidth="2" fill="none" />
        <circle cx="110" cy="75" r="5" fill="black" />
        <circle cx="145" cy="135" r="5" fill="black" />
        <circle cx="75" cy="135" r="5" fill="black" />
        <circle cx="110" cy="110" r="4" fill="black" />
      </svg>
    ),
  },
  {
    id: 3,
    title: "Architect",
    subtitle: "Systems Designer · L3",
    shortDesc: "Structure brings stability.",
    fullDesc:
      "You design with intention. Systems take shape with balance and symmetry. At this level, you are no longer experimenting, you are constructing frameworks others can rely on.",
    threshold: LEVEL_THRESHOLDS[2],
    symbol: (
      <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
        <circle cx="110" cy="110" r="80" stroke="black" strokeWidth="3" />
        <rect x="60" y="60" width="100" height="100" stroke="black" strokeWidth="2" fill="none" />
        <polygon points="110,75 145,110 110,145 75,110" stroke="black" strokeWidth="2" fill="none" />
        <circle cx="110" cy="75" r="5" fill="black" />
        <circle cx="145" cy="110" r="5" fill="black" />
        <circle cx="110" cy="145" r="5" fill="black" />
        <circle cx="75" cy="110" r="5" fill="black" />
        <circle cx="110" cy="110" r="4" fill="black" />
      </svg>
    ),
  },
  {
    id: 4,
    title: "Researcher",
    subtitle: "AI Specialist · L4",
    shortDesc: "The system expands outward.",
    fullDesc:
      "You move beyond contained systems. Your ideas influence and connect beyond their original boundaries. You understand not just structure, but interaction across systems.",
    threshold: LEVEL_THRESHOLDS[3],
    symbol: (
      <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
        <circle cx="110" cy="110" r="80" stroke="black" strokeWidth="3" />
        <rect x="60" y="60" width="100" height="100" stroke="black" strokeWidth="2" fill="none" />
        <polygon points="110,75 145,110 110,145 75,110" stroke="black" strokeWidth="2" fill="none" />
        <circle cx="110" cy="75" r="4" fill="black" />
        <circle cx="145" cy="110" r="4" fill="black" />
        <circle cx="110" cy="145" r="4" fill="black" />
        <circle cx="75" cy="110" r="4" fill="black" />
        <path d="M30 110 A80 80 0 0 1 190 110" stroke="black" strokeWidth="2" fill="none" />
        <path d="M110 30 A80 80 0 0 1 110 190" stroke="black" strokeWidth="2" fill="none" />
        <circle cx="25" cy="110" r="5" fill="black" />
        <circle cx="195" cy="110" r="5" fill="black" />
        <circle cx="110" cy="25" r="5" fill="black" />
        <circle cx="110" cy="195" r="5" fill="black" />
        <line x1="75" y1="110" x2="25" y2="110" stroke="black" strokeWidth="1.5" />
        <line x1="145" y1="110" x2="195" y2="110" stroke="black" strokeWidth="1.5" />
        <line x1="110" y1="75" x2="110" y2="25" stroke="black" strokeWidth="1.5" />
        <line x1="110" y1="145" x2="110" y2="195" stroke="black" strokeWidth="1.5" />
        <circle cx="110" cy="110" r="4" fill="black" />
      </svg>
    ),
  },
  {
    id: 5,
    title: "Lead Researcher",
    subtitle: "Master of Intelligence · L5",
    shortDesc: "Return to simplicity, with depth.",
    fullDesc:
      "You have come full circle. Complexity collapses into clarity. What once required structure is now understood intuitively. You operate with precision, simplicity, and quiet mastery.",
    threshold: LEVEL_THRESHOLDS[4],
    symbol: (
      <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
        <circle cx="110" cy="110" r="80" stroke="black" strokeWidth="4" />
        <circle cx="110" cy="110" r="62" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="46" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="30" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="16" stroke="black" strokeWidth="3" />
        <circle cx="110" cy="110" r="6" fill="black" />
      </svg>
    ),
  },
];

/* ── Helpers ─────────────────────────────────────────────────── */

function getUserLevel(canvasCount: number): number {
  const sorted = [...LEVEL_THRESHOLDS].sort((a, b) => b - a);
  for (let i = 0; i < sorted.length; i++) {
    if (canvasCount >= sorted[i]) {
      return LEVEL_THRESHOLDS.length - i; // 1-indexed level
    }
  }
  return 1;
}

/* ── Locked Placeholder Card ────────────────────────────────── */

const LockedCard: React.FC<{
  level: (typeof levels)[0];
  isMobile: boolean;
}> = ({ level, isMobile }) => {
  return (
    <div
      className={`
        guild-card-locked
        flex w-full flex-col items-center
        bg-white text-center
        border border-gray-200 overflow-hidden
        ${isMobile ? "rounded-2xl min-h-[360px]" : "absolute left-0 top-0 w-full rounded-2xl min-h-[360px]"}
      `}
    >
      {/* Greyed-out symbol area */}
      <div className="flex justify-center items-center w-full aspect-square border-b border-gray-100 p-6">
        <div style={{ opacity: 0.25, filter: "grayscale(100%)" }}>
          <svg width="120" height="120" viewBox="0 0 220 220" fill="none">
            <circle cx="110" cy="110" r="80" stroke="#aaa" strokeWidth="3" strokeDasharray="8 6" />
            <circle cx="110" cy="110" r="40" stroke="#bbb" strokeWidth="2" strokeDasharray="4 4" />
            <circle cx="110" cy="110" r="6" fill="#ccc" />
          </svg>
        </div>
      </div>

      {/* Locked info */}
      <div className="p-5 w-full flex flex-col items-center guild-lock-overlay">
        <p className="text-[17px] tracking-[0.15em] uppercase font-bold text-gray-500">
          Level {level.id}
        </p>
        <p className="mt-1.5 text-[13px] uppercase font-mono tracking-widest text-gray-400">
          {level.subtitle}
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9ca3af"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <p className="text-[14px] font-mono text-gray-500 max-w-[200px] leading-relaxed text-center">
            Create more flows to unlock this rank
          </p>
          <p className="text-[13px] font-mono text-gray-400 tracking-wider">
            Requires {level.threshold} {level.threshold === 1 ? "flow" : "flows"}
          </p>
        </div>
      </div>
    </div>
  );
};

/* ── Level Card (Unlocked) ──────────────────────────────────── */

const LevelCard: React.FC<{
  level: (typeof levels)[0];
  isExpanded: boolean;
  onToggle: () => void;
  isMobile: boolean;
}> = ({ level, isExpanded, onToggle, isMobile }) => {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      layout
      initial={false}
      animate={{
        y: isExpanded && !isMobile ? -8 : 0,
      }}
      transition={{
        layout: { type: "spring", stiffness: 260, damping: 22, mass: 0.9 },
        y: { type: "spring", stiffness: 260, damping: 22, mass: 0.9 },
        scale: { type: "spring", stiffness: 260, damping: 22, mass: 0.9 },
      }}
      className={`
        group flex flex-col items-center
        bg-white text-center outline-none
        border overflow-hidden
        transition-all duration-500 origin-top
        ${!isMobile ? `absolute top-0 ${isExpanded ? "-left-[20%] -right-[20%]" : "left-0 right-0"}` : "w-full"}
        ${isExpanded && !isMobile ? "border-black border-2 shadow-2xl z-[60]" : "border-gray-200 hover:border-black z-10"}
        ${isExpanded && isMobile ? "h-[100dvh] w-screen max-h-none rounded-none border-0" : `rounded-2xl h-auto min-h-[360px] ${isExpanded && !isMobile ? "max-h-[580px]" : "max-h-[500px]"}`}
      `}
    >
      <motion.div
        layout
        className="flex justify-center items-center w-full aspect-square border-b border-gray-100 p-6 group-hover:border-gray-200 transition-colors duration-500 shrink-0"
      >
        <motion.div
          animate={{ scale: isExpanded ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          {level.symbol}
        </motion.div>
      </motion.div>

      <motion.div
        layout
        className={`p-5 w-full flex flex-col items-center ${isExpanded ? "flex-1 overflow-y-auto custom-scrollbar" : ""}`}
      >
        <p className="text-[17px] tracking-[0.15em] uppercase font-bold text-black shrink-0">
          {level.title}
        </p>
        <p className="mt-1.5 text-[13px] uppercase font-mono tracking-widest text-gray-600 shrink-0">
          {level.subtitle}
        </p>

        <motion.p
          layout
          className="mt-4 text-[15px] font-mono leading-relaxed text-gray-600 max-w-[220px] shrink-0 text-center"
        >
          {level.shortDesc}
        </motion.p>

        <motion.div
          layout
          initial={false}
          style={{
            height: isExpanded ? "auto" : 0,
          }}
          className="overflow-hidden w-full shrink-0"
        >
          <motion.div
            layout="position"
            initial={false}
            animate={{
              opacity: isExpanded ? 1 : 0,
              y: isExpanded ? 0 : -10,
            }}
            transition={{
              duration: 0.2,
            }}
            className="pt-4"
          >
            <p className="text-[14px] font-mono leading-relaxed text-gray-700 text-left">
              {level.fullDesc}
            </p>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.button>
  );
};

/* ── Guild Page ─────────────────────────────────────────────── */

export default function GuildPage() {
  const navigate = useNavigate();
  const [expandedLevel, setExpandedLevel] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [canvasCount, setCanvasCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Fetch the user's canvas count to determine unlocked levels
  useEffect(() => {
    (async () => {
      try {
        const canvases = await apiListCanvases();
        setCanvasCount(canvases.length);
      } catch (err) {
        console.error("Failed to load canvases for guild:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const userLevel = getUserLevel(canvasCount);

  const toggleExpandedCard = (levelId: number) => {
    setExpandedLevel((cur) => (cur === levelId ? null : levelId));
  };

  if (loading) {
    return (
      <div className="guild-page h-[100dvh] w-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg width="60" height="60" viewBox="0 0 220 220" fill="none" className="animate-pulse">
            <circle cx="110" cy="110" r="80" stroke="#ccc" strokeWidth="3" />
            <circle cx="110" cy="110" r="50" stroke="#ddd" strokeWidth="2" />
            <circle cx="110" cy="110" r="6" fill="#bbb" />
          </svg>
          <p className="text-[13px] uppercase tracking-widest text-gray-500 font-mono">Loading Guild…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="guild-page h-[100dvh] w-screen flex flex-col relative overflow-hidden">
      {/* Background Architectural Lines */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden flex items-center justify-center opacity-[0.10]">
        <svg
          width="100%"
          height="100%"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute text-gray-500"
        >
          <defs>
            <pattern id="blueprint-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
            <pattern
              id="blueprint-grid-large"
              width="200"
              height="200"
              patternUnits="userSpaceOnUse"
            >
              <rect width="200" height="200" fill="url(#blueprint-grid)" />
              <path d="M 200 0 L 0 0 0 200" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#blueprint-grid-large)" />
          <line
            x1="20%"
            y1="0"
            x2="20%"
            y2="100%"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="10 5"
          />
          <line
            x1="80%"
            y1="0"
            x2="80%"
            y2="100%"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="10 5"
          />
          <line x1="0" y1="50%" x2="100%" y2="50%" stroke="currentColor" strokeWidth="0.5" />
          <circle
            cx="50%"
            cy="50%"
            r="350"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <circle
            cx="50%"
            cy="50%"
            r="352"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
          <path
            d="M 0 0 L 100% 100%"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.3"
          />
          <path
            d="M 100% 0 L 0 100%"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.3"
          />
        </svg>
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 right-0 w-full flex justify-between items-center p-6 md:p-8 z-50 pointer-events-none">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-4 pointer-events-auto hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-none outline-none"
        >
          <div className="w-5 h-5 border-[1.5px] border-black flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-black"></div>
          </div>
          <span className="font-mono text-base uppercase tracking-[0.25em] font-medium text-black">
            IntelliDraw Architectura
          </span>
        </button>
        <div className="hidden md:block font-mono text-[12px] uppercase tracking-widest text-gray-500">
          Est. 2026 // Void System
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full h-full flex items-center justify-center p-4 relative z-10 max-w-7xl mx-auto">
        {!isMobile ? (
          /* ── Desktop: 5-column grid ──────────────────────────── */
          <div className="w-full flex justify-center">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 w-full px-8">
              {levels.map((level) => {
                const isUnlocked = level.id <= userLevel;
                return (
                  <div key={level.id} className={`relative w-full h-[360px] ${expandedLevel === level.id ? "z-[60]" : "z-0"}`}>
                    {isUnlocked ? (
                      <LevelCard
                        level={level}
                        isExpanded={expandedLevel === level.id}
                        onToggle={() => toggleExpandedCard(level.id)}
                        isMobile={false}
                      />
                    ) : (
                      <LockedCard level={level} isMobile={false} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Mobile: swipeable card stack ─────────────────────── */
          <div className="relative w-full max-w-[320px] h-[500px] flex items-center justify-center">
            <div
              className={`absolute top-0 w-full text-center text-[12px] text-gray-500 uppercase font-mono tracking-widest ${expandedLevel ? "opacity-0" : "opacity-100"}`}
            >
              Swipe to navigate
            </div>

            <AnimatePresence>
              {levels.map((level, index) => {
                const diff = index - currentIndex;
                const isCurrent = diff === 0;
                const isExpanded = expandedLevel === level.id;
                const isUnlocked = level.id <= userLevel;

                if (!isExpanded && Math.abs(diff) > 2) return null;

                return (
                  <motion.div
                    layout
                    key={level.id}
                    className={
                      isExpanded ? "fixed inset-0 z-[100]" : "absolute w-full top-8"
                    }
                    style={{ zIndex: isExpanded ? 100 : 50 - index }}
                    initial={false}
                    animate={{
                      x: isExpanded ? 0 : diff < 0 ? -400 : 0,
                      y: isExpanded ? 0 : diff > 0 ? diff * 16 : 0,
                      scale: isExpanded ? 1 : diff > 0 ? 1 - diff * 0.05 : 1,
                      opacity: diff < 0 && !isExpanded ? 0 : 1,
                      rotate: isExpanded ? 0 : diff < 0 ? -15 : 0,
                    }}
                    transition={{
                      layout: {
                        type: "spring",
                        stiffness: 260,
                        damping: 24,
                        mass: 0.8,
                      },
                      type: "spring",
                      stiffness: 260,
                      damping: 24,
                      mass: 0.8,
                    }}
                    drag={isCurrent && !isExpanded ? "x" : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.4}
                    onDragEnd={(_e, { offset, velocity }) => {
                      const swipeThreshold = 50;
                      const velocityThreshold = 400;

                      if (
                        offset.x < -swipeThreshold ||
                        velocity.x < -velocityThreshold
                      ) {
                        if (currentIndex < levels.length - 1) {
                          setCurrentIndex(currentIndex + 1);
                          setExpandedLevel(null);
                        }
                      } else if (
                        offset.x > swipeThreshold ||
                        velocity.x > velocityThreshold
                      ) {
                        if (currentIndex > 0) {
                          setCurrentIndex(currentIndex - 1);
                          setExpandedLevel(null);
                        }
                      }
                    }}
                  >
                    <div
                      className={
                        !isCurrent && !isExpanded
                          ? "pointer-events-none w-full h-full"
                          : "w-full h-full"
                      }
                    >
                      {isUnlocked ? (
                        <LevelCard
                          level={level}
                          isExpanded={expandedLevel === level.id}
                          onToggle={() => toggleExpandedCard(level.id)}
                          isMobile={true}
                        />
                      ) : (
                        <LockedCard level={level} isMobile={true} />
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Carousel dots */}
            <div
              className={`absolute -bottom-6 flex gap-3 ${expandedLevel ? "opacity-0 pointer-events-none" : "opacity-100"}`}
            >
              {levels.map((_, idx) => (
                <div
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-none transition-colors ${
                    idx === currentIndex ? "bg-black" : "bg-gray-300"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="absolute bottom-0 left-0 right-0 w-full flex justify-between items-end p-6 md:p-8 z-[5] pointer-events-none">
        <div className="font-mono text-[12px] text-gray-500 max-w-xs leading-relaxed uppercase tracking-widest hidden md:block">
          Sacred Geometry
          <br />
          The study of forms and their meaning.
          <br />
          Access restricted to initiated members.
        </div>
        <div className="flex gap-3 items-end opacity-20">
          <div className="w-5 h-5 border-[1.5px] border-black rounded-full" />
          <div className="w-5 h-5 border-[1.5px] border-black" />
          <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[17.32px] border-l-transparent border-r-transparent border-b-black" />
        </div>
      </footer>
    </div>
  );
}
