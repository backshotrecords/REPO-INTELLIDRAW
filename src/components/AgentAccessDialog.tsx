import { useCallback, useEffect, useState } from "react";
import {
  apiAddAgentConnectionFolder,
  apiCreateAgentConnection,
  apiListAgentActions,
  apiListAgentConnections,
  apiListProjects,
  apiRevokeAgentConnection,
  apiRevokeAgentConnectionFolder,
  apiUpdateAgentConnection,
  apiUpdateAgentConnectionFolder,
} from "../lib/api";
import type {
  AgentAction,
  AgentConnection,
  AgentConnectionFolder,
  CanvasProject,
} from "../types";

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function operationLabel(operation: AgentAction["operation"]) {
  switch (operation) {
    case "list_folder": return "Viewed folder";
    case "get_flowchart": return "Read flowchart";
    case "validate_flowchart": return "Checked flowchart";
    case "create_flowchart": return "Created flowchart";
    case "update_flowchart": return "Updated flowchart";
  }
}

function OneTimeCredential({
  token,
  onDismiss,
}: {
  token: string;
  onDismiss: () => void;
}) {
  const endpoint = `${window.location.origin}/api/mcp`;
  const [copied, setCopied] = useState<"endpoint" | "token" | null>(null);

  const copy = async (kind: "endpoint" | "token", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-700">key</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-amber-950">Copy this key now</p>
          <p className="mt-1 text-xs leading-5 text-amber-900/75">
            For your security, Intellidraw will not show the full key again. Add the endpoint and key to your code agent&apos;s MCP connection settings.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <CredentialRow
          label="MCP endpoint"
          value={endpoint}
          copied={copied === "endpoint"}
          onCopy={() => void copy("endpoint", endpoint)}
        />
        <CredentialRow
          label="Access key"
          value={token}
          copied={copied === "token"}
          onCopy={() => void copy("token", token)}
          secret
        />
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={onDismiss} className="rounded-lg bg-amber-900 px-4 py-2 text-xs font-bold text-white">
          I saved the key
        </button>
      </div>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  copied,
  onCopy,
  secret,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  secret?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-900/70">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-slate-800 ring-1 ring-amber-200 ${secret ? "tracking-tight" : ""}`}>
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-9 items-center gap-1 rounded-lg bg-white px-3 text-xs font-bold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
        >
          <span className="material-symbols-outlined text-base">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function ConnectionCard({
  connection,
  projects,
  preferredProjectId,
  busy,
  onAddFolder,
  onFolderAccessChange,
  onFolderSubfoldersChange,
  onFolderRevoke,
  onRotate,
  onRevoke,
}: {
  connection: AgentConnection;
  projects: CanvasProject[];
  preferredProjectId?: string;
  busy: boolean;
  onAddFolder: (input: {
    projectId: string;
    accessLevel: "read" | "edit";
    includeSubfolders: boolean;
  }) => void;
  onFolderAccessChange: (folder: AgentConnectionFolder, accessLevel: "read" | "edit") => void;
  onFolderSubfoldersChange: (folder: AgentConnectionFolder, includeSubfolders: boolean) => void;
  onFolderRevoke: (folder: AgentConnectionFolder) => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const expired = connection.isExpired;
  const inactive = Boolean(connection.revokedAt) || expired;
  const activeFolders = connection.folders.filter((folder) => !folder.revokedAt);
  const availableProjects = projects.filter((project) => (
    !activeFolders.some((folder) => folder.projectId === project.id)
  ));
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [projectId, setProjectId] = useState(preferredProjectId || "");
  const [folderAccess, setFolderAccess] = useState<"read" | "edit">("edit");
  const [folderSubfolders, setFolderSubfolders] = useState(true);
  const selectedProjectId = availableProjects.some((project) => project.id === projectId)
    ? projectId
    : preferredProjectId && availableProjects.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : availableProjects[0]?.id || "";

  return (
    <div className={`rounded-xl border p-4 ${inactive ? "border-outline-variant/20 bg-surface-container-low/60" : "border-outline-variant/25 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-on-surface">{connection.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
              connection.revokedAt
                ? "bg-error-container text-error"
                : expired
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-800"
            }`}>
              {connection.revokedAt ? "Revoked" : expired ? "Expired" : "Active"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-on-surface-variant">{connection.tokenPrefix}…</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase text-primary">
          {activeFolders.length} {activeFolders.length === 1 ? "folder" : "folders"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
        <span>Last used: <strong>{formatDate(connection.lastUsedAt)}</strong></span>
        <span>Expires: <strong>{formatDate(connection.expiresAt)}</strong></span>
      </div>

      <div className="mt-4 space-y-2 border-t border-outline-variant/20 pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-wide text-on-surface-variant">Authorized folders</p>
          {!inactive && availableProjects.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowAddFolder((current) => !current)}
              className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
            >
              Add folder
            </button>
          )}
        </div>

        {activeFolders.length === 0 ? (
          <p className="rounded-lg bg-surface-container-low px-3 py-3 text-xs text-on-surface-variant">
            This key is active but cannot see any folders yet.
          </p>
        ) : activeFolders.map((folder) => (
          <div key={folder.id} className="rounded-lg bg-surface-container-low px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-bold text-on-surface">{folder.projectTitle || "Untitled folder"}</p>
              <select
                value={folder.accessLevel}
                disabled={busy || inactive}
                onChange={(event) => onFolderAccessChange(folder, event.target.value as "read" | "edit")}
                className="rounded-md border border-outline-variant/30 bg-white px-2 py-1.5 text-[11px] font-bold text-on-surface outline-none"
                aria-label={`Access level for ${folder.projectTitle}`}
              >
                <option value="read">Read only</option>
                <option value="edit">Can edit</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                disabled={busy || inactive}
                onClick={() => onFolderSubfoldersChange(folder, !folder.includeSubfolders)}
                className="text-on-surface-variant hover:text-primary disabled:opacity-50"
              >
                Subfolders: <strong>{folder.includeSubfolders ? "Included" : "Not included"}</strong>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onFolderRevoke(folder)}
                className="font-bold text-error hover:underline disabled:opacity-50"
              >
                Remove access
              </button>
            </div>
          </div>
        ))}

        {showAddFolder && !inactive && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-primary/15 bg-primary/5 p-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-on-surface sm:col-span-2">
              Folder
              <select
                value={selectedProjectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2 text-sm font-normal outline-none"
              >
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-on-surface">
              Access
              <select
                value={folderAccess}
                onChange={(event) => setFolderAccess(event.target.value as "read" | "edit")}
                className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2 text-sm font-normal outline-none"
              >
                <option value="read">Read only</option>
                <option value="edit">Can create and edit</option>
              </select>
            </label>
            <label className="flex items-center gap-3 self-end rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-on-surface ring-1 ring-outline-variant/20">
              <input
                type="checkbox"
                checked={folderSubfolders}
                onChange={(event) => setFolderSubfolders(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Include subfolders
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setShowAddFolder(false)} className="px-3 py-2 text-xs font-bold text-on-surface-variant">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !selectedProjectId}
                onClick={() => {
                  onAddFolder({
                    projectId: selectedProjectId,
                    accessLevel: folderAccess,
                    includeSubfolders: folderSubfolders,
                  });
                  setShowAddFolder(false);
                }}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                Authorize folder
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRotate}
          className="rounded-lg border border-outline-variant/30 px-3 py-2 text-xs font-bold text-primary hover:bg-surface-container-low disabled:opacity-50"
        >
          {inactive ? "Create new key" : "Replace key"}
        </button>
        {!connection.revokedAt && (
          <button
            type="button"
            disabled={busy}
            onClick={onRevoke}
            className="rounded-lg px-3 py-2 text-xs font-bold text-error hover:bg-error-container/30 disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

function AgentConnectionsPanel({
  project,
  showActivity,
}: {
  project?: CanvasProject;
  showActivity?: boolean;
}) {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("Codex");
  const [accessLevel, setAccessLevel] = useState<"read" | "edit">("edit");
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState<30 | 90 | 365>(90);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextConnections, nextActions, nextProjects] = await Promise.all([
        apiListAgentConnections(),
        showActivity ? apiListAgentActions({ projectId: project?.id, limit: 30 }) : Promise.resolve([]),
        apiListProjects(),
      ]);
      setConnections(nextConnections);
      setActions(nextActions);
      setProjects(nextProjects.filter((candidate) => (
        !candidate.manually_archived
        && (
          candidate.access_level === "owner"
          || candidate.capabilities?.includes("project.manage_shares")
        )
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load code agent access");
    } finally {
      setLoading(false);
    }
  }, [project?.id, showActivity]);

  useEffect(() => {
    void load();
  }, [load]);

  const createConnection = async () => {
    setBusyId("create");
    setError("");
    try {
      const result = await apiCreateAgentConnection({
        ...(project ? { projectId: project.id } : {}),
        name,
        accessLevel,
        includeSubfolders,
        expiresInDays,
      });
      setConnections((current) => [result.connection, ...current]);
      setToken(result.token);
      setShowCreate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create code agent access");
    } finally {
      setBusyId(null);
    }
  };

  const addFolder = async (
    connection: AgentConnection,
    input: {
      projectId: string;
      accessLevel: "read" | "edit";
      includeSubfolders: boolean;
    },
  ) => {
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiAddAgentConnectionFolder(connection.id, input);
      setConnections((current) => current.map((item) => (
        item.id === connection.id
          ? {
            ...item,
            folders: [
              ...item.folders.filter((folder) => folder.id !== result.folder.id),
              result.folder,
            ],
            activeFolderCount: item.folders.filter((folder) => (
              !folder.revokedAt && folder.id !== result.folder.id
            )).length + 1,
          }
          : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not authorize folder");
    } finally {
      setBusyId(null);
    }
  };

  const updateFolder = async (
    connection: AgentConnection,
    folder: AgentConnectionFolder,
    updates: { accessLevel?: "read" | "edit"; includeSubfolders?: boolean },
  ) => {
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiUpdateAgentConnectionFolder(connection.id, folder.id, updates);
      setConnections((current) => current.map((item) => (
        item.id === connection.id
          ? {
            ...item,
            folders: item.folders.map((candidate) => (
              candidate.id === folder.id ? result.folder : candidate
            )),
          }
          : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update folder access");
    } finally {
      setBusyId(null);
    }
  };

  const revokeFolder = async (
    connection: AgentConnection,
    folder: AgentConnectionFolder,
  ) => {
    if (!window.confirm(`Remove ${folder.projectTitle} from ${connection.name}? The key will immediately lose access to this folder.`)) return;
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiRevokeAgentConnectionFolder(connection.id, folder.id);
      setConnections((current) => current.map((item) => (
        item.id === connection.id
          ? {
            ...item,
            folders: item.folders.map((candidate) => (
              candidate.id === folder.id
                ? { ...candidate, revokedAt: result.revokedAt }
                : candidate
            )),
            activeFolderCount: Math.max(0, item.activeFolderCount - 1),
          }
          : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove folder access");
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (connection: AgentConnection) => {
    if (!window.confirm(`Replace the key for ${connection.name}? Its current key will stop working immediately.`)) return;
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiUpdateAgentConnection(connection.id, { rotate: true });
      setConnections((current) => current.map((item) => item.id === connection.id ? result.connection : item));
      if (result.token) setToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not replace the key");
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (connection: AgentConnection) => {
    if (!window.confirm(`Revoke ${connection.name}? The code agent will immediately lose access to every authorized folder.`)) return;
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiRevokeAgentConnection(connection.id);
      setConnections((current) => current.map((item) => (
        item.id === connection.id ? { ...item, revokedAt: result.revokedAt } : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke code agent access");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {token && <OneTimeCredential token={token} onDismiss={() => setToken(null)} />}

      {!token && (
        <div className="rounded-xl bg-primary/5 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-bold text-on-surface">
                {project ? "Connect a code agent to this folder" : "Create a code agent connection"}
              </p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                {project
                  ? "Add this folder to an existing key below, or create a separate connection."
                  : "Generate one key, then choose every folder that key is allowed to use."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate((current) => !current)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white"
            >
              <span className="material-symbols-outlined text-base">add_link</span>
              New connection
            </button>
          </div>

          {showCreate && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-primary/10 pt-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-on-surface">
                Connection name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:ring-2 focus:ring-primary/20"
                  maxLength={80}
                />
              </label>
              {project && (
                <label className="text-xs font-bold text-on-surface">
                  Access to this folder
                  <select
                    value={accessLevel}
                    onChange={(event) => setAccessLevel(event.target.value as "read" | "edit")}
                    className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2.5 text-sm font-normal outline-none"
                  >
                    <option value="read">Read only</option>
                    <option value="edit">Can create and edit</option>
                  </select>
                </label>
              )}
              <label className="text-xs font-bold text-on-surface">
                Key expires
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value) as 30 | 90 | 365)}
                  className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2.5 text-sm font-normal outline-none"
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                </select>
              </label>
              {project && (
                <label className="flex items-center gap-3 self-end rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-on-surface ring-1 ring-outline-variant/20">
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    onChange={(event) => setIncludeSubfolders(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Include subfolders
                </label>
              )}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2 text-xs font-bold text-on-surface-variant">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId === "create" || !name.trim()}
                  onClick={() => void createConnection()}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busyId === "create" ? "Creating…" : "Generate key"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-error-container/40 px-3 py-2 text-sm text-error">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-bold text-on-surface">Connections</h4>
          <button type="button" onClick={() => void load()} className="text-xs font-bold text-primary hover:underline">
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-on-surface-variant">Loading connections…</p>
        ) : connections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/40 px-4 py-8 text-center">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">smart_toy</span>
            <p className="mt-2 text-sm font-bold text-on-surface">No code agents connected</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Generate a key when you are ready, then authorize one or more folders.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                projects={projects}
                preferredProjectId={project?.id}
                busy={busyId === connection.id}
                onAddFolder={(input) => void addFolder(connection, input)}
                onFolderAccessChange={(folder, nextAccess) => void updateFolder(connection, folder, { accessLevel: nextAccess })}
                onFolderSubfoldersChange={(folder, nextValue) => void updateFolder(connection, folder, { includeSubfolders: nextValue })}
                onFolderRevoke={(folder) => void revokeFolder(connection, folder)}
                onRotate={() => void rotate(connection)}
                onRevoke={() => void revoke(connection)}
              />
            ))}
          </div>
        )}
      </div>

      {showActivity && actions.length > 0 && (
        <div>
          <h4 className="mb-3 font-bold text-on-surface">Recent activity</h4>
          <div className="divide-y divide-outline-variant/20 rounded-xl border border-outline-variant/20 bg-white">
            {actions.map((action) => (
              <div key={action.id} className="flex items-start gap-3 px-4 py-3">
                <span className={`material-symbols-outlined mt-0.5 text-lg ${
                  action.status === "success" ? "text-emerald-600" : action.status === "conflict" ? "text-amber-600" : "text-error"
                }`}>
                  {action.operation.includes("flowchart") ? "account_tree" : "folder_open"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-on-surface">{action.change_summary || operationLabel(action.operation)}</p>
                  {action.reason && <p className="mt-1 text-xs text-on-surface-variant">{action.reason}</p>}
                  <p className="mt-1 text-[10px] text-on-surface-variant/70">
                    {action.connection_name} · {formatDate(action.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectedAgentsSection() {
  return (
    <section className="grid grid-cols-1 gap-8 md:grid-cols-3">
      <div className="md:col-span-1">
        <h3 className="text-xl font-headline font-bold text-primary">Connected Code Agents</h3>
        <p className="mt-2 text-sm text-on-surface-variant">
          Create a key once, then add or remove the folders it can use without reconnecting your code agent.
        </p>
      </div>
      <div className="md:col-span-2">
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-6 shadow-sm">
          <AgentConnectionsPanel />
        </div>
      </div>
    </section>
  );
}

export default function AgentAccessDialog({
  project,
  onClose,
}: {
  project: CanvasProject;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto px-4 py-10">
      <button type="button" className="fixed inset-0 bg-primary/35 backdrop-blur-sm" aria-label="Close Agent access" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-2xl bg-surface-container-lowest shadow-ambient-lg">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 px-6 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-secondary">Agent access</p>
            <h3 className="mt-1 text-2xl font-extrabold text-primary">{project.title}</h3>
            <p className="mt-1 text-sm text-on-surface-variant">
              Add this folder to an existing key, or create a separate connection.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-surface-container-low" aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-6">
          <AgentConnectionsPanel project={project} showActivity />
        </div>
      </div>
    </div>
  );
}
