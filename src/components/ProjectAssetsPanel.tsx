import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ASSET_ACCENT_TILE,
  ASSET_TYPE_META,
  getProjectAssetIcon,
  type ProjectAsset,
  type ProjectAssetType,
  type ProjectAssetLink,
  type RegisterProjectAssetInput,
} from "../lib/projectAssets";

export interface AssetTargetOption {
  id: string;
  title: string;
}

interface ProjectAssetsPanelProps {
  variant: "workspace" | "dashboard";
  assets: ProjectAsset[];
  links: ProjectAssetLink[];
  /** Workspace variant: scopes per-canvas counts and metadata to this canvas. */
  currentCanvasId?: string | null;
  /** Canvas id -> title, used for metadata rows and canvas-link labels. */
  canvasTitles?: Map<string, string>;
  /** Canvases/folders inside the root project tree, offered as link targets. */
  canvasOptions?: AssetTargetOption[];
  folderOptions?: AssetTargetOption[];
  linkingAvailable?: boolean;
  linkingLockedBadge?: ReactNode;
  linkingEnabled?: boolean;
  armedAssetId?: string | null;
  onToggleLinking?: () => void;
  onLinkingLocked?: () => void;
  onArmAsset?: (assetId: string) => void;
  onRegisterAsset: (input: RegisterProjectAssetInput) => void;
  onUpdateAsset: (asset: ProjectAsset, patch: Partial<Pick<ProjectAsset, "name" | "markdown">>) => void;
  onRemoveAsset: (asset: ProjectAsset) => void;
  /** Open a canvas/folder reference asset. */
  onOpenAssetTarget?: (asset: ProjectAsset) => void;
  onRemoveLink: (link: ProjectAssetLink) => void;
  onToggleLinkStatus: (link: ProjectAssetLink) => void;
  onClose: () => void;
  registerRowRef?: (assetId: string, element: HTMLDivElement | null) => void;
  onHoverAsset?: (assetId: string | null) => void;
  className?: string;
  loading?: boolean;
  notice?: string | null;
  onDismissNotice?: () => void;
}

const REGISTER_TYPES: ProjectAssetType[] = ["markdown", "canvas", "project"];

export default function ProjectAssetsPanel({
  variant,
  assets,
  links,
  currentCanvasId,
  canvasTitles,
  canvasOptions = [],
  folderOptions = [],
  linkingAvailable = true,
  linkingLockedBadge,
  linkingEnabled = false,
  armedAssetId = null,
  onToggleLinking,
  onLinkingLocked,
  onArmAsset,
  onRegisterAsset,
  onUpdateAsset,
  onRemoveAsset,
  onOpenAssetTarget,
  onRemoveLink,
  onToggleLinkStatus,
  onClose,
  registerRowRef,
  onHoverAsset,
  className = "",
  loading = false,
  notice = null,
  onDismissNotice,
}: ProjectAssetsPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [newAssetType, setNewAssetType] = useState<ProjectAssetType>("markdown");
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetTargetId, setNewAssetTargetId] = useState("");
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");

  const isWorkspace = variant === "workspace";
  const armedAsset = armedAssetId ? assets.find((asset) => asset.id === armedAssetId) ?? null : null;
  const editingAsset = editingAssetId ? assets.find((asset) => asset.id === editingAssetId) ?? null : null;

  // If the asset being edited disappears (removed elsewhere), drop the editor.
  useEffect(() => {
    if (editingAssetId && !editingAsset) setEditingAssetId(null);
  }, [editingAssetId, editingAsset]);

  const metadataLinks = useMemo(() => {
    if (isWorkspace) {
      return currentCanvasId ? links.filter((link) => link.canvasId === currentCanvasId) : [];
    }
    return links;
  }, [isWorkspace, currentCanvasId, links]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const targetOptions = newAssetType === "canvas" ? canvasOptions : newAssetType === "project" ? folderOptions : [];

  function countLinks(assetId: string, canvasId?: string | null) {
    return links.filter((link) => link.assetId === assetId && (!canvasId || link.canvasId === canvasId)).length;
  }

  function countCanvases(assetId: string) {
    return new Set(links.filter((link) => link.assetId === assetId).map((link) => link.canvasId)).size;
  }

  function describeAsset(asset: ProjectAsset) {
    const totalLinks = countLinks(asset.id);
    const spanCanvases = countCanvases(asset.id);
    const typeLabel = ASSET_TYPE_META[asset.type].label;
    return `${typeLabel} · ${totalLinks} link${totalLinks === 1 ? "" : "s"} · ${spanCanvases} canvas${spanCanvases === 1 ? "" : "es"}`;
  }

  function resetAddForm() {
    setShowAddForm(false);
    setNewAssetName("");
    setNewAssetTargetId("");
    setNewAssetType("markdown");
  }

  function handleAddAsset() {
    if (newAssetType === "markdown") {
      const name = newAssetName.trim();
      if (!name) return;
      onRegisterAsset({ type: "markdown", name, markdown: "" });
    } else {
      const target = targetOptions.find((option) => option.id === newAssetTargetId);
      if (!target) return;
      const name = newAssetName.trim() || target.title;
      onRegisterAsset({ type: newAssetType, name, targetId: target.id });
    }
    resetAddForm();
  }

  function openMarkdownEditor(asset: ProjectAsset) {
    setEditingAssetId(asset.id);
    setDraftName(asset.name);
    setDraftMarkdown(asset.markdown ?? "");
  }

  function saveMarkdownEditor() {
    if (!editingAsset) return;
    onUpdateAsset(editingAsset, { name: draftName, markdown: draftMarkdown });
    setEditingAssetId(null);
  }

  function handleRowClick(asset: ProjectAsset) {
    if (isEditing) return;
    if (isWorkspace && linkingAvailable && linkingEnabled) {
      onArmAsset?.(asset.id);
      return;
    }
    if (asset.type === "markdown") openMarkdownEditor(asset);
    else onOpenAssetTarget?.(asset);
  }

  const canAddReference = newAssetType !== "markdown";
  const addDisabled = newAssetType === "markdown" ? !newAssetName.trim() : !newAssetTargetId;

  return (
    <div
      className={`bg-white/95 backdrop-blur-2xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-outline-variant/20 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200 ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editingAsset ? (
        <>
          <div className="px-4 py-3.5 border-b border-outline-variant/10 flex items-center gap-2 shrink-0">
            <button
              onClick={() => setEditingAssetId(null)}
              className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors shrink-0"
              title="Back to assets"
              aria-label="Back to assets"
            >
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </button>
            <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${ASSET_ACCENT_TILE[editingAsset.accent]}`}>
              <span className="material-symbols-outlined text-lg">description</span>
            </span>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="min-w-0 flex-1 bg-transparent border-none outline-none text-sm font-bold text-on-surface focus:ring-2 focus:ring-secondary rounded-md px-1"
              aria-label="Asset name"
            />
            <button
              onClick={saveMarkdownEditor}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-white shrink-0"
            >
              Save
            </button>
          </div>
          <textarea
            value={draftMarkdown}
            onChange={(event) => setDraftMarkdown(event.target.value)}
            placeholder={"# Notes\n\nWrite markdown for this asset…"}
            className="flex-1 min-h-[260px] resize-none bg-transparent px-4 py-3 text-xs font-mono leading-relaxed text-on-surface outline-none custom-scrollbar"
            spellCheck={false}
          />
          <div className="px-4 py-2 border-t border-outline-variant/10 flex items-center justify-between text-[10px] font-bold text-on-surface-variant/50 shrink-0">
            <span>Markdown · saved locally</span>
            <span>{draftMarkdown.length} chars</span>
          </div>
        </>
      ) : (
        <>
          <div className="px-5 py-4 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-lg text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>hub</span>
              <span className="font-bold text-sm text-on-surface truncate">Project Assets</span>
              <span className="text-[10px] font-bold text-on-surface-variant/50 bg-surface-container-high px-1.5 py-0.5 rounded-full shrink-0">
                {assets.length}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setIsEditing((prev) => !prev)}
                className={`p-1.5 rounded-lg transition-colors ${isEditing ? "bg-primary text-white" : "text-on-surface-variant hover:text-primary hover:bg-primary/5"}`}
                title={isEditing ? "Done editing" : "Edit assets"}
                aria-label={isEditing ? "Done editing" : "Edit assets"}
              >
                <span className="material-symbols-outlined text-lg">{isEditing ? "check" : "edit"}</span>
              </button>
              <button
                onClick={() => setShowAddForm((prev) => !prev)}
                className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/5 rounded-lg transition-colors"
                title="Register asset"
                aria-label="Register asset"
              >
                <span className="material-symbols-outlined text-lg">add</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-lg transition-colors"
                title="Close"
                aria-label="Close project assets"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
          </div>

          {isWorkspace && (
            <div className="mx-4 mt-3 shrink-0 rounded-xl bg-surface-container-high/55 px-3 py-2 flex items-center justify-between gap-3">
              <span className="min-w-0 flex items-center gap-2 text-xs font-bold text-on-surface">
                <span className="truncate">Asset linking</span>
                {!linkingAvailable && linkingLockedBadge}
              </span>
              <button
                role="switch"
                aria-checked={linkingAvailable && linkingEnabled}
                aria-label="Toggle asset linking"
                onClick={() => {
                  if (!linkingAvailable) {
                    onLinkingLocked?.();
                    return;
                  }
                  onToggleLinking?.();
                }}
                className={`w-8 h-[18px] rounded-full px-0.5 flex items-center transition-colors ${linkingAvailable && linkingEnabled ? "bg-primary justify-end" : "bg-outline-variant/30 justify-start"}`}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-white" />
              </button>
            </div>
          )}
          {isWorkspace && armedAsset && (
            <p className="mx-4 mt-2 shrink-0 rounded-lg bg-[#d1e0ff]/50 px-2.5 py-2 text-[11px] font-semibold leading-snug text-[#063d77]">
              Tap nodes on the canvas to link <strong className="font-extrabold">{armedAsset.name}</strong>.
              Tap a linked node to unlink. Esc to cancel.
            </p>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5 custom-scrollbar">
            {notice && (
              <button
                onClick={() => onDismissNotice?.()}
                className="w-full text-left rounded-lg bg-error/5 border border-error/15 px-3 py-2 text-[11px] font-semibold text-error/90 hover:bg-error/10 transition-colors"
                title="Dismiss"
              >
                {notice}
              </button>
            )}
            {loading && assets.length === 0 ? (
              <div className="flex justify-center py-8"><div className="spinner w-6 h-6" /></div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-on-surface-variant/40">
                <span className="material-symbols-outlined text-3xl">hub</span>
                <p className="text-xs font-medium text-center">
                  No project assets registered yet.
                  <br />
                  Add a markdown doc or link a canvas/folder.
                </p>
              </div>
            ) : (
              assets.map((asset) => {
                const isArmed = armedAssetId === asset.id;
                const canvasCount = isWorkspace && currentCanvasId ? countLinks(asset.id, currentCanvasId) : 0;
                const isArmable = isWorkspace && linkingAvailable && linkingEnabled && !isEditing;
                const rowActionIcon = isArmable
                  ? (isArmed ? "close" : "add_link")
                  : asset.type === "markdown" ? "edit_note" : "open_in_new";

                return (
                  <div
                    key={asset.id}
                    ref={(element) => registerRowRef?.(asset.id, element)}
                    role={isEditing ? undefined : "button"}
                    tabIndex={isEditing ? undefined : 0}
                    onClick={() => handleRowClick(asset)}
                    onKeyDown={(event) => {
                      if (!isEditing && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        handleRowClick(asset);
                      }
                    }}
                    onMouseEnter={() => onHoverAsset?.(asset.id)}
                    onMouseLeave={() => onHoverAsset?.(null)}
                    className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors ${
                      isArmed
                        ? "border-primary bg-primary/5"
                        : isEditing
                          ? "border-outline-variant/40 bg-white/90"
                          : "border-outline-variant/40 bg-white/90 cursor-pointer hover:border-primary/25 hover:bg-outline-variant/20"
                    }`}
                  >
                    <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${ASSET_ACCENT_TILE[asset.accent]}`}>
                      <span className="material-symbols-outlined text-xl">{getProjectAssetIcon(asset)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-on-surface">{asset.name}</span>
                      <span className="block truncate text-[10px] font-semibold text-on-surface-variant/60">
                        {describeAsset(asset)}
                      </span>
                    </span>
                    {isWorkspace && canvasCount > 0 && (
                      <span
                        className={`shrink-0 flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${isArmed ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant/70"}`}
                        title="Links on this canvas"
                      >
                        <span className="material-symbols-outlined text-[12px] leading-none">link</span>
                        {canvasCount}
                      </span>
                    )}
                    {isEditing ? (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveAsset(asset);
                        }}
                        className="shrink-0 p-1.5 rounded-lg text-error/70 hover:text-error hover:bg-error/5 transition-colors"
                        title={`Remove ${asset.name}`}
                        aria-label={`Remove ${asset.name}`}
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    ) : (
                      <span className={`material-symbols-outlined shrink-0 text-lg ${isArmed ? "text-primary" : "text-on-surface-variant/45"}`}>
                        {rowActionIcon}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {showAddForm && (
            <div className="border-t border-outline-variant/10 px-4 py-4 bg-surface-container-lowest shrink-0">
              <h4 className="text-xs font-bold text-on-surface uppercase mb-3">Register Asset</h4>
              <div className="flex gap-1 mb-2">
                {REGISTER_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setNewAssetType(type);
                      setNewAssetTargetId("");
                    }}
                    className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-extrabold transition-colors ${
                      newAssetType === type ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant hover:bg-outline-variant/30"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px] leading-none">{ASSET_TYPE_META[type].icon}</span>
                    {ASSET_TYPE_META[type].label}
                  </button>
                ))}
              </div>
              {canAddReference && (
                <select
                  value={newAssetTargetId}
                  onChange={(event) => setNewAssetTargetId(event.target.value)}
                  className="w-full bg-surface-container-high border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-secondary mb-2"
                >
                  <option value="">
                    {targetOptions.length === 0
                      ? `No ${newAssetType === "canvas" ? "canvases" : "folders"} in this project tree`
                      : `Select a ${newAssetType === "canvas" ? "canvas" : "folder"}…`}
                  </option>
                  {targetOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.title}</option>
                  ))}
                </select>
              )}
              <input
                value={newAssetName}
                onChange={(event) => setNewAssetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !addDisabled) handleAddAsset();
                }}
                placeholder={canAddReference ? "Display name (optional — uses target title)" : "Doc name (e.g. Billing Policy)"}
                className="w-full bg-surface-container-high border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-secondary mb-3"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={resetAddForm}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container-high/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddAsset}
                  disabled={addDisabled}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-white disabled:opacity-40 transition-opacity"
                >
                  Register
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-outline-variant/10 bg-white/95 shrink-0">
            <button
              onClick={() => setMetadataOpen((prev) => !prev)}
              aria-expanded={metadataOpen}
              className="w-full px-4 py-2.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-on-surface-variant/70 hover:text-primary hover:bg-primary/[0.03] transition-colors"
            >
              <span>Link metadata</span>
              <span className="ml-auto rounded-full bg-surface-container-high px-1.5 py-0.5 normal-case tracking-normal">
                {metadataLinks.length} record{metadataLinks.length === 1 ? "" : "s"}
              </span>
              <span className="material-symbols-outlined text-base">{metadataOpen ? "keyboard_arrow_down" : "keyboard_arrow_up"}</span>
            </button>
            {metadataOpen && (
              metadataLinks.length > 0 ? (
                <div className="max-h-[150px] overflow-y-auto px-4 pb-3 space-y-1 custom-scrollbar">
                  {metadataLinks.map((link) => {
                    const asset = assetById.get(link.assetId);
                    const targetLabel = isWorkspace
                      ? link.nodeId
                      : canvasTitles?.get(link.canvasId) ?? link.canvasId.slice(0, 8);

                    return (
                      <div key={link.id} className="flex items-center gap-1.5 rounded-lg bg-surface-container-high/50 px-2 py-1.5">
                        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600" title={`${link.assetId} → ${link.canvasId} → ${link.nodeId}`}>
                          {asset?.name ?? link.assetId} → {targetLabel}
                        </code>
                        <button
                          onClick={() => {
                            if (!linkingAvailable) {
                              onLinkingLocked?.();
                              return;
                            }
                            onToggleLinkStatus(link);
                          }}
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide transition-colors ${
                            link.status === "pending" ? "bg-[#fff0d1]/90 text-[#9a5a00]" : "bg-[#d5f6e1]/90 text-[#116b34]"
                          }`}
                          title="Toggle link status"
                        >
                          {link.status}
                        </button>
                        <button
                          onClick={() => onRemoveLink(link)}
                          className="shrink-0 p-1 rounded-md text-on-surface-variant/50 hover:text-error hover:bg-error/5 transition-colors"
                          title="Remove link"
                          aria-label="Remove link"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-4 pb-3 text-[11px] font-semibold text-on-surface-variant/50">
                  {isWorkspace ? "No asset links on this canvas yet." : "No asset links in this project yet."}
                </p>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
