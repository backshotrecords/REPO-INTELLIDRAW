import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGetEntitlements } from "../lib/api";
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
  }), [entitlements, isLoading, refreshEntitlements]);

  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}
