import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGetEntitlements, USAGE_CHANGED_EVENT } from "../lib/api";
import type { EntitlementsSnapshot, SubscriptionPlanId } from "../types";
import { useAuth } from "../hooks/useAuth";
import { EntitlementsContext } from "./EntitlementsContextDef";

export function EntitlementsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [entitlements, setEntitlements] = useState<EntitlementsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshEntitlements = useCallback(async () => {
    if (!isAuthenticated) {
      setEntitlements(null);
      return;
    }

    setIsLoading(true);
    try {
      setEntitlements(await apiGetEntitlements());
    } catch (err) {
      console.error("Failed to load entitlements:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    void refreshEntitlements();
  }, [authLoading, refreshEntitlements]);

  // Refetch usage counts shortly after any quota-affecting API call so meters
  // (avatar ring, hover card) stay current without waiting for a page reload.
  useEffect(() => {
    if (!isAuthenticated) return;
    let timer: number | null = null;
    const handleUsageChanged = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshEntitlements();
      }, 1200);
    };
    window.addEventListener(USAGE_CHANGED_EVENT, handleUsageChanged);
    return () => {
      window.removeEventListener(USAGE_CHANGED_EVENT, handleUsageChanged);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isAuthenticated, refreshEntitlements]);

  const value = useMemo(() => ({
    entitlements,
    isLoading,
    refreshEntitlements,
    hasFeature: (key: string) => {
      if (isLoading && !entitlements) return true;
      return Boolean(entitlements?.featureMap[key]?.enabled);
    },
    getFeature: (key: string) => entitlements?.featureMap[key] ?? null,
    getRequiredPlan: (key: string) => entitlements?.featureMap[key]?.requiredPlan ?? null,
    getPlanName: (planId: SubscriptionPlanId | null | undefined) => {
      if (!planId) return "";
      return entitlements?.plans.find((plan) => plan.id === planId)?.name || String(planId).toUpperCase();
    },
    getQuotaStatus: (key: string) => {
      const feature = entitlements?.featureMap[key];
      if (!feature || !feature.enabled || feature.quota === null || feature.quota === undefined) return null;
      const quota = feature.quota;
      const usage = Math.max(0, feature.usage ?? 0);
      const remaining = Math.max(0, quota - usage);
      const percentRemaining = quota > 0 ? Math.round((remaining / quota) * 100) : 0;
      return {
        quota,
        usage,
        remaining,
        percentUsed: 100 - percentRemaining,
        percentRemaining,
        resetPeriodDays: feature.resetPeriodDays,
      };
    },
  }), [entitlements, isLoading, refreshEntitlements]);

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}
