import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useCommunityAccess } from "../contexts/CommunityAccessContext";
import { useEntitlements } from "../hooks/useEntitlements";
import PlanBadge from "./PlanBadge";
import QuotaMeterList from "./QuotaMeterList";

const RING_RADIUS = 21;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ringColor(percentUsed: number) {
  if (percentUsed <= 30) return "#22c55e";
  if (percentUsed <= 80) return "#eab308";
  return "#ef4444";
}

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const { openCommunityAccess } = useCommunityAccess();
  const { entitlements, getQuotaStatus } = useEntitlements();
  const aiChatQuota = getQuotaStatus("canvas.ai_chat");
  const [showUsageCard, setShowUsageCard] = useState(false);
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    navigate("/");
  };

  return (
    <div
      className="relative"
      ref={dropdownRef}
      onMouseEnter={() => setShowUsageCard(true)}
      onMouseLeave={() => setShowUsageCard(false)}
    >
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        onFocus={() => setShowUsageCard(true)}
        onBlur={() => setShowUsageCard(false)}
        className="relative w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary font-bold text-sm hover:ring-2 hover:ring-secondary/30 transition-all active:scale-95"
      >
        {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
        {aiChatQuota && (
          <svg
            className="absolute -inset-1 h-12 w-12 -rotate-90 pointer-events-none"
            viewBox="0 0 48 48"
            role="img"
            aria-label={`AI canvas chat usage: ${aiChatQuota.percentUsed}%`}
          >
            <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="3" />
            <circle
              cx="24"
              cy="24"
              r={RING_RADIUS}
              fill="none"
              stroke={ringColor(aiChatQuota.percentUsed)}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - Math.min(100, aiChatQuota.percentUsed) / 100)}
              className="transition-all duration-500"
            />
          </svg>
        )}
      </button>

      {showUsageCard && !showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 p-4 z-50 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-outline-variant/10">
            <div>
              <p className="text-xs text-on-surface-variant">Current plan</p>
              <p className="font-bold text-on-surface">{entitlements?.plan?.name || "Free"}</p>
            </div>
            <PlanBadge planId={entitlements?.plan?.id} />
          </div>
          <QuotaMeterList />
        </div>
      )}

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-ambient-lg border border-outline-variant/10 py-2 z-50 animate-in fade-in slide-in-from-top-2">
          {/* User info */}
          <div className="px-4 py-3 border-b border-outline-variant/10">
            <p className="font-bold text-sm text-on-surface truncate">
              {user?.displayName}
            </p>
            <p className="text-xs text-on-surface-variant truncate">
              {user?.email}
            </p>
          </div>

          <button
            onClick={() => {
              navigate("/settings");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">settings</span>
            Settings
          </button>

          <button
            onClick={() => {
              navigate("/user-management");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">groups</span>
            User Management
          </button>

          <button
            onClick={() => {
              navigate("/dashboard");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">dashboard</span>
            My Canvases
          </button>

          <div className="h-px bg-outline-variant/10 my-1" />

          <button
            onClick={() => {
              openCommunityAccess("contact");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">contact_support</span>
            Contact
          </button>

          <button
            onClick={() => {
              openCommunityAccess("help");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">help</span>
            Help
          </button>

          <div className="h-px bg-outline-variant/10 my-1" />

          {user?.isGlobalAdmin && (
            <button
              onClick={() => {
                navigate("/admin");
                setShowDropdown(false);
              }}
              className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-primary font-semibold"
            >
              <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
              Admin Rules
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 text-left text-sm text-error hover:bg-error-container/20 flex items-center gap-3"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
