import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getOfflineOperations } from "../lib/offlineQueue";

// "reconnecting" = verifying the connection (neutral UI); "syncing" = verified online, restoring queued work (success UI).
type ConnectivityStatus = "online" | "offline" | "reconnecting" | "syncing";
type ReconnectHandler = () => Promise<void> | void;

// Client-side polling of navigator.onLine only — never pings the server on a timer.
const ONLINE_POLL_INTERVAL_MS = 2000;
// Minimum spacing between automatic reconnect attempts while the browser claims to be online.
const AUTO_RECONNECT_INTERVAL_MS = 10000;

interface ConnectivityContextValue {
  status: ConnectivityStatus;
  isOffline: boolean;
  isBlocked: boolean;
  message: string;
  queueCount: number;
  reportNetworkFailure: () => void;
  setReconnectMessage: (message: string) => void;
  retryConnection: () => Promise<void>;
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
      for (const handler of Array.from(handlersRef.current)) {
        await handler();
        refreshQueueCount();
      }
    } catch (err) {
      console.error("Reconnect queue processing failed:", err);
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

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("intellidraw-offline-queue-change", handleQueueChange);
    window.addEventListener("intellidraw-network-failure", handleNetworkFailure);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("intellidraw-offline-queue-change", handleQueueChange);
      window.removeEventListener("intellidraw-network-failure", handleNetworkFailure);
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
      registerReconnectHandler,
    }),
    [
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
