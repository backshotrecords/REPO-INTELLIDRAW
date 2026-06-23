import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CommunityAccessModal } from "../components/CommunityAccessModal";
import { useAuth } from "../hooks/useAuth";
import { apiGetSettings, apiRequestManagedApiKey } from "../lib/api";

export type ApiKeyRequestStatus = "none" | "requested" | "fulfilled" | "dismissed";
export type CommunityAccessSource = "auto" | "contact" | "help" | "settings" | "api-key";

export interface CommunityAccessConfig {
  enabled: boolean;
  whatsappCommunityUrl: string;
  memberCountLabel: string;
  memberCopy: string;
}

interface CommunityAccessContextValue {
  config: CommunityAccessConfig;
  requestStatus: ApiKeyRequestStatus;
  requestError: string | null;
  requesting: boolean;
  reloadCommunityAccess: () => Promise<void>;
  openCommunityAccess: (source?: CommunityAccessSource) => void;
  closeCommunityAccess: () => void;
}

const DEFAULT_CONFIG: CommunityAccessConfig = {
  enabled: true,
  whatsappCommunityUrl: "https://chat.whatsapp.com/Jr1BYruwnVbKxv8iwJ6aQo",
  memberCountLabel: "+84",
  memberCopy: "Over 80+ active creators inside",
};

const CommunityAccessContext = createContext<CommunityAccessContextValue | null>(null);

export function CommunityAccessProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [config, setConfig] = useState<CommunityAccessConfig>(DEFAULT_CONFIG);
  const [requestStatus, setRequestStatus] = useState<ApiKeyRequestStatus>("none");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [source, setSource] = useState<CommunityAccessSource>("auto");
  const autoOpenedForUser = useRef<string | null>(null);

  const reloadCommunityAccess = useCallback(async () => {
    if (!isAuthenticated) return;
    const data = await apiGetSettings();
    if (data.communityAccess) {
      setConfig({ ...DEFAULT_CONFIG, ...data.communityAccess });
    }
    setRequestStatus((data.user?.apiKeyRequestStatus || "none") as ApiKeyRequestStatus);
    setSettingsLoaded(true);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    setSettingsLoaded(false);
    reloadCommunityAccess().catch(() => setSettingsLoaded(true));
  }, [isAuthenticated, isLoading, reloadCommunityAccess]);

  useEffect(() => {
    if (!user || isLoading || !settingsLoaded || !config.enabled || user.hasApiKey) return;
    if (requestStatus === "requested" || requestStatus === "fulfilled") return;
    if (autoOpenedForUser.current === user.id) return;

    autoOpenedForUser.current = user.id;
    setSource("auto");
    setModalOpen(true);
  }, [config.enabled, isLoading, requestStatus, settingsLoaded, user]);

  const openCommunityAccess = useCallback((nextSource: CommunityAccessSource = "contact") => {
    setRequestError(null);
    setSource(nextSource);
    setModalOpen(true);
  }, []);

  const closeCommunityAccess = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleJoin = useCallback(async () => {
    window.open(config.whatsappCommunityUrl, "_blank", "noopener,noreferrer");
    if (user?.hasApiKey) return;

    setRequesting(true);
    setRequestError(null);
    try {
      const data = await apiRequestManagedApiKey();
      setRequestStatus((data.apiKeyRequestStatus || "requested") as ApiKeyRequestStatus);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Failed to record API key request");
      throw err;
    } finally {
      setRequesting(false);
    }
  }, [config.whatsappCommunityUrl, user?.hasApiKey]);

  const value = useMemo<CommunityAccessContextValue>(
    () => ({
      config,
      requestStatus,
      requestError,
      requesting,
      reloadCommunityAccess,
      openCommunityAccess,
      closeCommunityAccess,
    }),
    [
      closeCommunityAccess,
      config,
      openCommunityAccess,
      reloadCommunityAccess,
      requestError,
      requestStatus,
      requesting,
    ],
  );

  return (
    <CommunityAccessContext.Provider value={value}>
      {children}
      <CommunityAccessModal
        open={modalOpen}
        config={config}
        hasApiKey={!!user?.hasApiKey}
        requestStatus={requestStatus}
        requestError={requestError}
        requesting={requesting}
        source={source}
        onClose={closeCommunityAccess}
        onJoin={handleJoin}
      />
    </CommunityAccessContext.Provider>
  );
}

export function useCommunityAccess() {
  const context = useContext(CommunityAccessContext);
  if (!context) {
    throw new Error("useCommunityAccess must be used within a CommunityAccessProvider");
  }
  return context;
}
