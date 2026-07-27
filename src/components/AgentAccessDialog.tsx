import { useCallback, useEffect, useState } from "react";
import {
  apiCreateAgentConnection,
  apiListAgentActions,
  apiListAgentConnections,
  apiRevokeAgentConnection,
  apiUpdateAgentConnection,
} from "../lib/api";
import type { AgentAction, AgentConnection, CanvasProject } from "../types";

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
  busy,
  onAccessChange,
  onSubfoldersChange,
  onRotate,
  onRevoke,
}: {
  connection: AgentConnection;
  busy: boolean;
  onAccessChange: (accessLevel: "read" | "edit") => void;
  onSubfoldersChange: (includeSubfolders: boolean) => void;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const expired = connection.isExpired;
  const inactive = Boolean(connection.revokedAt) || expired;

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
          {connection.rootProjectTitle && (
            <p className="mt-1 text-xs font-semibold text-primary">{connection.rootProjectTitle}</p>
          )}
          <p className="mt-1 font-mono text-[11px] text-on-surface-variant">{connection.tokenPrefix}…</p>
        </div>

        {!inactive && (
          <select
            value={connection.accessLevel}
            disabled={busy}
            onChange={(event) => onAccessChange(event.target.value as "read" | "edit")}
            className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface outline-none"
            aria-label={`Access level for ${connection.name}`}
          >
            <option value="read">Read only</option>
            <option value="edit">Can edit</option>
          </select>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-on-surface-variant sm:grid-cols-3">
        <button
          type="button"
          disabled={busy || inactive}
          onClick={() => onSubfoldersChange(!connection.includeSubfolders)}
          className="text-left hover:text-primary disabled:pointer-events-none"
          title={inactive ? undefined : "Change subfolder access"}
        >
          Subfolders: <strong>{connection.includeSubfolders ? "Included" : "Not included"}</strong>
        </button>
        <span>Last used: <strong>{formatDate(connection.lastUsedAt)}</strong></span>
        <span>Expires: <strong>{formatDate(connection.expiresAt)}</strong></span>
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
      const [nextConnections, nextActions] = await Promise.all([
        apiListAgentConnections(project?.id),
        showActivity ? apiListAgentActions({ projectId: project?.id, limit: 30 }) : Promise.resolve([]),
      ]);
      setConnections(nextConnections);
      setActions(nextActions);
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
    if (!project) return;
    setBusyId("create");
    setError("");
    try {
      const result = await apiCreateAgentConnection({
        projectId: project.id,
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

  const updateAccess = async (connection: AgentConnection, nextAccess: "read" | "edit") => {
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiUpdateAgentConnection(connection.id, { accessLevel: nextAccess });
      setConnections((current) => current.map((item) => item.id === connection.id ? result.connection : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update code agent access");
    } finally {
      setBusyId(null);
    }
  };

  const updateSubfolders = async (connection: AgentConnection, nextValue: boolean) => {
    setBusyId(connection.id);
    setError("");
    try {
      const result = await apiUpdateAgentConnection(connection.id, { includeSubfolders: nextValue });
      setConnections((current) => current.map((item) => item.id === connection.id ? result.connection : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update subfolder access");
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
    if (!window.confirm(`Revoke ${connection.name}? The code agent will immediately lose access to this folder.`)) return;
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

      {project && !token && (
        <div className="rounded-xl bg-primary/5 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-bold text-on-surface">Connect a code agent to this folder</p>
              <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                You choose whether it can only read or can also create and update flowcharts.
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
              <label className="text-xs font-bold text-on-surface">
                Access
                <select
                  value={accessLevel}
                  onChange={(event) => setAccessLevel(event.target.value as "read" | "edit")}
                  className="mt-1.5 w-full rounded-lg border border-outline-variant/30 bg-white px-3 py-2.5 text-sm font-normal outline-none"
                >
                  <option value="read">Read only</option>
                  <option value="edit">Can create and edit</option>
                </select>
              </label>
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
              <label className="flex items-center gap-3 self-end rounded-lg bg-white px-3 py-2.5 text-xs font-bold text-on-surface ring-1 ring-outline-variant/20">
                <input
                  type="checkbox"
                  checked={includeSubfolders}
                  onChange={(event) => setIncludeSubfolders(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Include subfolders
              </label>
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
              {project ? "Generate a key when you are ready." : "Open a project folder and choose Agent access to create one."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                busy={busyId === connection.id}
                onAccessChange={(nextAccess) => void updateAccess(connection, nextAccess)}
                onSubfoldersChange={(nextValue) => void updateSubfolders(connection, nextValue)}
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
          Review every code agent key you created, see when it was last used, replace it, or revoke it.
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
              Each key is controlled by you and only opens this folder.
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
