import { useLocation, useNavigate } from "react-router-dom";

const tabs = [
  { id: "canvases", label: "Canvases", icon: "dashboard", path: "/dashboard" },
  { id: "draw", label: "Draw", icon: "draw", path: "/canvas/new" },
  { id: "chat", label: "AI Chat", icon: "smart_toy", path: "/canvas/new" },
  { id: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const getActiveTab = () => {
    if (location.pathname === "/settings") return "settings";
    if (location.pathname.startsWith("/canvas")) return "draw";
    return "canvases";
  };

  const activeTab = getActiveTab();

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-6 pt-2 bg-white/80 backdrop-blur-2xl rounded-t-3xl shadow-[0px_-12px_32px_rgba(24,28,30,0.06)] md:hidden">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={`flex flex-col items-center justify-center px-5 py-2 transition-all active:scale-90 duration-150 ${
              isActive
                ? "bg-slate-900 text-white rounded-2xl"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <span
              className={`material-symbols-outlined ${isActive ? "fill" : ""}`}
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {tab.icon}
            </span>
            <span className="font-inter text-[10px] font-semibold uppercase tracking-wider mt-1">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
