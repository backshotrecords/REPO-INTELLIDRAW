import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getOfflineOperations } from "../lib/offlineQueue";

type ConnectivityStatus = "online" | "offline" | "reconnecting";
type ReconnectHandler = () => Promise<void> | void;

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

  const refreshQueueCount = useCallback(() => {
    setQueueCount(getOfflineOperations().length);
  }, []);

  const reportNetworkFailure = useCallback(() => {
    setStatus("offline");
    setMessage("You're currently offline");
  }, []);

  const setReconnectMessage = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
  }, []);

  const runReconnect = useCallback(async () => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setStatus("reconnecting");
    setMessage("Back online");

    const reachable = await canReachProduction();
    if (!reachable) {
      setStatus("offline");
      setMessage("You're currently offline");
      reconnectingRef.current = false;
      return;
    }

    setMessage("Checking saved work...");
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
    window.setTimeout(() => {
      setStatus("online");
      setMessage("");
      reconnectingRef.current = false;
      refreshQueueCount();
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
    const handleOffline = () => {
      setStatus("offline");
      setMessage("You're currently offline");
    };
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

  useEffect(() => {
    if (navigator.onLine && getOfflineOperations().length > 0) {
      void runReconnect();
    }
  }, [runReconnect]);

  const value = useMemo<ConnectivityContextValue>(
    () => ({
      status,
      isOffline: status === "offline",
      isBlocked: status === "offline" || status === "reconnecting",
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
