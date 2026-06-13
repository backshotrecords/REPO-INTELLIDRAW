import { useConnectivity } from "../contexts/ConnectivityContext";

export default function ConnectivityOverlay({ children }: { children: React.ReactNode }) {
  const { status, isBlocked, message, queueCount, retryConnection, clearPendingQueue } = useConnectivity();
  const isChecking = status === "reconnecting";
  const isSyncing = status === "syncing";

  const handleClearPending = () => {
    const confirmed = window.confirm(
      "Clear pending offline work? This discards unsynced messages, saves, uploads, and voice recordings stored on this device."
    );
    if (confirmed) {
      void clearPendingQueue();
    }
  };

  return (
    <div className="relative min-h-screen">
      {isBlocked && (
        <div
          className={`fixed inset-x-0 top-0 z-[220] flex h-7 items-center justify-center px-4 text-xs font-bold tracking-wide text-white shadow-sm ${
            isSyncing ? "bg-emerald-600" : isChecking ? "bg-slate-600" : "bg-red-600"
          }`}
        >
          {isSyncing
            ? "Back online - syncing changes"
            : isChecking
              ? "Checking connection..."
              : "Offline - changes cannot be saved"}
        </div>
      )}

      <div
        className={`min-h-screen transition-[filter,opacity] duration-200 ${
          isBlocked ? "pointer-events-none select-none blur-[3px] brightness-50" : ""
        }`}
        inert={isBlocked}
      >
        {children}
      </div>

      {isBlocked && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center px-4 pt-8">
          <div className="rounded-2xl bg-white/95 px-5 py-3 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl sm:rounded-full">
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <span
                  className={`material-symbols-outlined text-lg ${
                    isSyncing ? "text-emerald-600" : isChecking ? "animate-spin text-slate-600" : "text-red-600"
                  }`}
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {isSyncing || isChecking ? "sync" : "wifi_off"}
                </span>
                <span>{message || "You're currently offline"}</span>
                {queueCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-600">
                    {queueCount} pending
                  </span>
                )}
              </div>
              {(status === "offline" || queueCount > 0) && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  {status === "offline" && (
                    <button
                      type="button"
                      onClick={() => void retryConnection()}
                      className="rounded-full bg-red-600 px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-red-600/20 transition active:scale-95"
                    >
                      Retry connection
                    </button>
                  )}
                  {queueCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearPending}
                      className="rounded-full bg-slate-900 px-4 py-2 text-xs font-extrabold text-white shadow-lg shadow-slate-900/15 transition active:scale-95"
                    >
                      Clear pending
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
