import type { ReactNode } from "react";

export type DashboardFileViewMode = "tree" | "grid";

export default function DashboardFileViewToggle({
  mode,
  onChange,
}: {
  mode: DashboardFileViewMode;
  onChange: (mode: DashboardFileViewMode) => void;
}) {
  return (
    <div className="dashboard-file-view-toggle" role="group" aria-label="File view">
      <span className="dashboard-file-view-selected" style={{ transform: `translateX(${mode === "tree" ? "0%" : "100%"})` }} />
      <ToggleButton mode="tree" selected={mode === "tree"} label="Tree view" onChange={onChange}>
        <OrgChartIcon />
      </ToggleButton>
      <ToggleButton mode="grid" selected={mode === "grid"} label="Grid view" onChange={onChange}>
        <GridIcon />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  mode,
  selected,
  label,
  children,
  onChange,
}: {
  mode: DashboardFileViewMode;
  selected: boolean;
  label: string;
  children: ReactNode;
  onChange: (mode: DashboardFileViewMode) => void;
}) {
  return (
    <button
      type="button"
      className={`dashboard-file-view-option${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onPointerDown={() => onChange(mode)}
    >
      <span className="dashboard-file-view-check">
        <span className="material-symbols-outlined">check</span>
      </span>
      <span className="dashboard-file-view-icon">{children}</span>
    </button>
  );
}

function OrgChartIcon() {
  return (
    <svg viewBox="0 0 64 58" aria-hidden="true">
      <rect x="22" y="3" width="20" height="20" rx="3" />
      <rect x="5" y="35" width="20" height="20" rx="3" />
      <rect x="39" y="35" width="20" height="20" rx="3" />
      <path d="M32 23V31M15 35V31H49V35" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 64 58" aria-hidden="true">
      <rect x="12" y="7" width="17" height="17" rx="2.8" />
      <rect x="35" y="7" width="17" height="17" rx="2.8" />
      <rect x="12" y="33" width="17" height="17" rx="2.8" />
      <rect x="35" y="33" width="17" height="17" rx="2.8" />
    </svg>
  );
}
