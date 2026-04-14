import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function ProfileMenu() {
  const { user, logout } = useAuth();
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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary font-bold text-sm hover:ring-2 hover:ring-secondary/30 transition-all active:scale-95"
      >
        {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
      </button>

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
              navigate("/dashboard");
              setShowDropdown(false);
            }}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface-container-low flex items-center gap-3 text-on-surface"
          >
            <span className="material-symbols-outlined text-lg">dashboard</span>
            My Canvases
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
