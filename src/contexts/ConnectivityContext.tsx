import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OPERATION_STORAGE_KEY, clearOfflineQueue, getOfflineOperations } from "../lib/offlineQueue";

// "reconnecting" = verifying the connection (neutral UI); "syncing" = verified online, restoring queued work (success UI).
type ConnectivityStatus = "online" | "offline" | "reconnecting" | "syncing";
type ReconnectHandler = () => Promise<void> | void;

// Client-side polling of navigator.onLine only — never pings the server on a timer.
const ONLINE_POLL_INTERVAL_MS = 2000;
// Minimum spacing between automatic reconnect attempts while the browser claims to be online.
const AUTO_RECONNECT_INTERVAL_MS = 10000;
// Cross-tab lock: the offline queue lives in shared localStorage, so only one
// tab may drain it at a time or operations get double-sent or resurrected.
const QUEUE_LOCK_NAME = "intellidraw-offline-queue";

interface ConnectivityContextValue {
  status: ConnectivityStatus;
  isOffline: boolean;
  isBlocked: boolean;
  message: string;
  queueCount: number;
  reportNetworkFailure: () => void;
  setReconnectMessage: (message: string) => void;
  retryConnection: () => Promise<void>;
  clearPendingQueue: () => Promise<void>;
  registerReconnectHandler: (handler: ReconnectHandler) => () => void;
}

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

async function canReachProduction() {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch("/api/canvases", {
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    window.clearTimeout(timeout);
    return response.status !== 0;
  } catch {
    return false;
  }
}

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectivityStatus>(() => (navigator.onLine ? "online" : "offline"));
  const [message, setMessage] = useState(() => (navigator.onLine ? "" : "You're currently offline"));
  const [queueCount, setQueueCount] = useState(() => getOfflineOperations().length);
  const handlersRef = useRef(new Set<ReconnectHandler>());
  const reconnectingRef = useRef(false);
  const onlineTimerRef = useRef<number | null>(null);
  const lastAutoReconnectRef = useRef(0);
  const statusRef = useRef(status);
  const queueClearGenerationRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refreshQueueCount = useCallback(() => {
    setQueueCount(getOfflineOperations().length);
  }, []);

  // A pending timer means runReconnect's async work already finished, so the
  // timer owns the in-flight flag — cancelling it must release the flag too.
  const clearOnlineTimer = useCallback(() => {
    if (onlineTimerRef.current !== null) {
      window.clearTimeout(onlineTimerRef.current);
      onlineTimerRef.current = null;
      reconnectingRef.current = false;
    }
  }, []);

  const reportNetworkFailure = useCallback(() => {
    clearOnlineTimer();
    setStatus("offline");
    setMessage("You're currently offline");
  }, [clearOnlineTimer]);

  const setReconnectMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  const runReconnect = useCallback(async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    const clearGenerationAtStart = queueClearGenerationRef.current;
    lastAutoReconnectRef.current = Date.now();
    setStatus("reconnecting");
    setMessage("Checking connection...");

    const reachable = await canReachProduction();
    if (!reachable) {
      setStatus("offline");
      setMessage("You're currently offline");
      reconnectingRef.current = false;
      return;
    }

    setStatus("syncing");
    setMessage("Back online - checking saved work...");
    try {
      const runHandlers = async () => {
        for (const handler of Array.from(handlersRef.current)) {
          await handler();
          refreshQueueCount();
        }
      };
      if (navigator.locks) {
        await navigator.locks.request(QUEUE_LOCK_NAME, runHandlers);
      } else {
        await runHandlers();
      }
    } catch (err) {
      console.error("Reconnect queue processing failed:", err);
      if (queueClearGenerationRef.current !== clearGenerationAtStart) {
        reconnectingRef.current = false;
        refreshQueueCount();
        if (navigator.onLine) {
          setStatus("online");
          setMessage("");
        }
        return;
      }
      setStatus("offline");
      setMessage("Connection restored, but sync needs retry");
      reconnectingRef.current = false;
      return;
    }

    setMessage("All changes restored");
    onlineTimerRef.current = window.setTimeout(() => {
      onlineTimerRef.current = null;
      reconnectingRef.current = false;
      refreshQueueCount();
      // The connection may have dropped again while the success message was showing.
      if (!navigator.onLine || statusRef.current === "offline") {
        setStatus("offline");
        setMessage("You're currently offline");
        return;
      }
      setStatus("online");
      setMessage("");
    }, 900);
  }, [refreshQueueCount]);

  const retryConnection = useCallback(async () => {
    await runReconnect();
  }, [runReconnect]);

  const clearPendingQueue = useCallback(async () => {
    queueClearGenerationRef.current += 1;
    clearOnlineTimer();
    reconnectingRef.current = false;
    await clearOfflineQueue();
    refreshQueueCount();
    if (navigator.onLine) {
      setStatus("online");
      setMessage("");
    } else {
      setStatus("offline");
      setMessage("Pending work cleared");
    }
  }, [clearOnlineTimer, refreshQueueCount]);

  const registerReconnectHandler = useCallback((handler: ReconnectHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    const handleOffline = () => reportNetworkFailure();
    const handleOnline = () => {
      void runReconnect();
    };
    const handleQueueChange = () => refreshQueueCount();
    const handleNetworkFailure = () => reportNetworkFailure();
    // Queue changes made by other tabs arrive via the storage event (the
    // custom queue-change event only fires in the tab that wrote the change).
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === OPERATION_STORAGE_KEY) {
        refreshQueueCount();
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("intellidraw-offline-queue-change", handleQueueChange);
    window.addEventListener("intellidraw-network-failure", handleNetworkFailure);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("intellidraw-offline-queue-change", handleQueueChange);
      window.removeEventListener("intellidraw-network-failure", handleNetworkFailure);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshQueueCount, reportNetworkFailure, runReconnect]);

  // Active detection: poll the browser's connectivity state so the offline UI
  // appears even when the offline event never fires, and keep attempting to
  // reconnect for as long as the app is open. Stays entirely client-side —
  // the server is only probed via runReconnect, spaced by AUTO_RECONNECT_INTERVAL_MS.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!navigator.onLine) {
        if (statusRef.current === "online") {
          reportNetworkFailure();
        }
        return;
      }
      if (statusRef.current === "offline") {
        if (Date.now() - lastAutoReconnectRef.current >= AUTO_RECONNECT_INTERVAL_MS) {
          void runReconnect();
        }
      }
    }, ONLINE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [reportNetworkFailure, runReconnect]);

  useEffect(() => {
    if (navigator.onLine && getOfflineOperations().length > 0) {
      void runReconnect();
    }
  }, [runReconnect]);

  const value = useMemo<ConnectivityContextValue>(
    () => ({
      status,
      isOffline: status === "offline",
      isBlocked: status !== "online",
      message,
      queueCount,
      reportNetworkFailure,
      setReconnectMessage,
      retryConnection,
      clearPendingQueue,
      registerReconnectHandler,
    }),
    [
      clearPendingQueue,
      message,
      queueCount,
      registerReconnectHandler,
      reportNetworkFailure,
      retryConnection,
      setReconnectMessage,
      status,
    ]
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  const value = useContext(ConnectivityContext);
  if (!value) {
    throw new Error("useConnectivity must be used within a ConnectivityProvider");
  }
  return value;
}
