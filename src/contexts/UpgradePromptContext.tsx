import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { UpgradePlanModal } from "../components/UpgradePlanModal";
import { useCommunityAccess } from "./CommunityAccessContext";
import { useEntitlements } from "../hooks/useEntitlements";
import type { SubscriptionPlanId } from "../types";

interface UpgradePromptOptions {
  featureKey: string;
  featureLabel: string;
  requiredPlan?: SubscriptionPlanId | null;
}

interface UpgradePromptState {
  featureKey: string;
  featureLabel: string;
  requiredPlan: SubscriptionPlanId | null;
}

interface UpgradePromptContextValue {
  openUpgradePrompt: (options: UpgradePromptOptions) => void;
  closeUpgradePrompt: () => void;
}

const UpgradePromptContext = createContext<UpgradePromptContextValue | null>(null);

export function UpgradePromptProvider({ children }: { children: React.ReactNode }) {
  const { config } = useCommunityAccess();
  const { getPlanName, getRequiredPlan } = useEntitlements();
  const [prompt, setPrompt] = useState<UpgradePromptState | null>(null);

  const openUpgradePrompt = useCallback((options: UpgradePromptOptions) => {
    setPrompt({
      featureKey: options.featureKey,
      featureLabel: options.featureLabel,
      requiredPlan: options.requiredPlan ?? getRequiredPlan(options.featureKey),
    });
  }, [getRequiredPlan]);

  const closeUpgradePrompt = useCallback(() => {
    setPrompt(null);
  }, []);

  const handleUpgrade = useCallback(() => {
    window.open(config.whatsappCommunityUrl, "_blank", "noopener,noreferrer");
  }, [config.whatsappCommunityUrl]);

  const value = useMemo(() => ({
    openUpgradePrompt,
    closeUpgradePrompt,
  }), [closeUpgradePrompt, openUpgradePrompt]);

  const planName = prompt?.requiredPlan ? getPlanName(prompt.requiredPlan) : "";

  return (
    <UpgradePromptContext.Provider value={value}>
      {children}
      <UpgradePlanModal
        open={!!prompt}
        featureLabel={prompt?.featureLabel || "This feature"}
        requiredPlan={prompt?.requiredPlan || null}
        planName={planName}
        onClose={closeUpgradePrompt}
        onUpgrade={handleUpgrade}
      />
    </UpgradePromptContext.Provider>
  );
}

export function useUpgradePrompt() {
  const context = useContext(UpgradePromptContext);
  if (!context) {
    throw new Error("useUpgradePrompt must be used within an UpgradePromptProvider");
  }
  return context;
}
