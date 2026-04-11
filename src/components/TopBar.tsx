import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface TopBarProps {
  showSearch?: boolean;
  onSearchChange?: (value: string) => void;
}

export default function TopBar({ showSearch, onSearchChange }: TopBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
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
    <>
      <header className="bg-slate-50/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex justify-between items-center w-full px-6 py-4">
          <div className="flex items-center gap-4">
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setShowMobileMenu(true)}
              className="md:hidden hover:bg-slate-200/50 transition-colors active:scale-95 duration-200 p-2 rounded-full"
            >
              <span className="material-symbols-outlined text-slate-900">menu</span>
            </button>
            <span
              className="text-xl font-extrabold text-slate-900 font-manrope tracking-tight cursor-pointer"
              onClick={() => navigate("/dashboard")}
            >
              IntelliDraw
            </span>
          </div>

          {showSearch && (
            <div className="hidden md:flex flex-1 max-w-md mx-8">
              <div className="relative w-full">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                  search
                </span>
                <input
                  className="w-full bg-surface-container-high border-none rounded-xl py-2 pl-10 pr-4 focus:ring-2 focus:ring-secondary text-sm outline-none"
                  placeholder="Search canvases..."
                  type="text"
                  onChange={(e) => onSearchChange?.(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* User avatar + dropdown */}
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
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-[100] md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowMobileMenu(false)}
          />

          {/* Sidebar panel */}
          <div className="absolute left-0 top-0 h-full w-72 bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/10">
              <span className="text-lg font-extrabold text-primary font-manrope tracking-tight">
                IntelliDraw
              </span>
              <button
                onClick={() => setShowMobileMenu(false)}
                className="p-2 rounded-full hover:bg-surface-container-high text-on-surface-variant"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* User card */}
            <div className="px-6 py-5 border-b border-outline-variant/10 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary-container flex items-center justify-center text-on-primary font-bold text-lg">
                {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-on-surface truncate">{user?.displayName}</p>
                <p className="text-xs text-on-surface-variant truncate">{user?.email}</p>
              </div>
            </div>

            {/* Nav links */}
            <nav className="flex-1 py-4 px-3 space-y-1">
              <button
                onClick={() => {
                  navigate("/dashboard");
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  dashboard
                </span>
                My Canvases
              </button>
              <button
                onClick={() => {
                  navigate("/canvas/new");
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  draw
                </span>
                New Canvas
              </button>
              <button
                onClick={() => {
                  navigate("/settings");
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  settings
                </span>
                Settings
              </button>
            </nav>

            {/* Logout at bottom */}
            <div className="px-3 pb-6 border-t border-outline-variant/10 pt-4">
              <button
                onClick={() => {
                  handleLogout();
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-error hover:bg-error-container/20 transition-colors"
              >
                <span className="material-symbols-outlined">logout</span>
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
