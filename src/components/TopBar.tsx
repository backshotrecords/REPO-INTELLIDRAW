import { useAuth } from "../contexts/AuthContext";

interface TopBarProps {
  showSearch?: boolean;
  onMenuClick?: () => void;
}

export default function TopBar({ showSearch, onMenuClick }: TopBarProps) {
  const { user } = useAuth();

  return (
    <header className="bg-slate-50/70 backdrop-blur-xl sticky top-0 z-40">
      <div className="flex justify-between items-center w-full px-6 py-4">
        <div className="flex items-center gap-4">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="hover:bg-slate-200/50 transition-colors active:scale-95 duration-200 p-2 rounded-full"
            >
              <span className="material-symbols-outlined text-slate-900">menu</span>
            </button>
          )}
          <span className="text-xl font-extrabold text-slate-900 font-manrope tracking-tight">
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
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary font-bold text-sm">
            {user?.displayName?.charAt(0)?.toUpperCase() || "U"}
          </div>
        </div>
      </div>
    </header>
  );
}
