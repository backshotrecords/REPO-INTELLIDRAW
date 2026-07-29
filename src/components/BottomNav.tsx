import { useLocation, useNavigate } from "react-router-dom";

const tabs = [
  { id: "canvases", label: "Canvases", icon: "dashboard", path: "/dashboard" },
  { id: "skills", label: "Skills", icon: "auto_awesome", path: "/skills" },
  { id: "quick-launch", label: "Quick Launch", icon: "mic", path: "/canvas/new?quick=1", primary: true },
  { id: "guild", label: "Guild", icon: "trophy", path: "/guild" },
  { id: "settings", label: "Settings", icon: "settings", path: "/settings" },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const getActiveTab = () => {
    if (location.pathname === "/settings") return "settings";
    if (location.pathname === "/skills") return "skills";
    if (location.pathname === "/guild") return "guild";
    return "canvases";
  };

  const activeTab = getActiveTab();

  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="Primary navigation">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        if (tab.primary) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate(tab.path)}
              className="mobile-bottom-nav-quick-launch"
              aria-label={tab.label}
            >
              <span className="mobile-bottom-nav-quick-launch-circle">
                <span className="material-symbols-outlined fill">{tab.icon}</span>
              </span>
              <span>{tab.label}</span>
            </button>
          );
        }
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => navigate(tab.path)}
            className={`mobile-bottom-nav-item ${
              isActive
                ? "active"
                : ""
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            <span
              className={`material-symbols-outlined${isActive ? " fill" : ""}`}
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
