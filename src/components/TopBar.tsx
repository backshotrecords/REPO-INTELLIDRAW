import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import ProfileMenu from "./ProfileMenu";

interface TopBarProps {
  showSearch?: boolean;
  onSearchChange?: (value: string) => void;
}

export default function TopBar({ showSearch, onSearchChange }: TopBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <>
      <header className="bg-slate-50/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex justify-between items-center w-full px-6 py-4">
          <div className="flex items-center gap-4">
            {/* Hamburger */}
            <button
              onClick={() => setShowMobileMenu(true)}
              className="hover:bg-slate-200/50 transition-colors active:scale-95 duration-200 p-2 rounded-full"
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

          <ProfileMenu />
        </div>
      </header>

      {/* Mobile/Desktop sidebar overlay */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-[100]">
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
              <button
                onClick={() => {
                  navigate("/skills");
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                  auto_awesome
                </span>
                Skill Marketplace
              </button>
              {user?.isGlobalAdmin && (
                <button
                  onClick={() => {
                    navigate("/admin");
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-primary hover:bg-surface-container-low transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                    admin_panel_settings
                  </span>
                  Admin Rules
                </button>
              )}
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
