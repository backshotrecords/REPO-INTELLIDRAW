import { createContext } from "react";
import type { EntitlementFeature, EntitlementsSnapshot, SubscriptionPlanId } from "../types";

export interface EntitlementsContextType {
  entitlements: EntitlementsSnapshot | null;
  isLoading: boolean;
  refreshEntitlements: () => Promise<void>;
  hasFeature: (key: string) => boolean;
  getFeature: (key: string) => EntitlementFeature | null;
  getRequiredPlan: (key: string) => SubscriptionPlanId | null;
  getPlanName: (planId: SubscriptionPlanId | null | undefined) => string;
}

export const EntitlementsContext = createContext<EntitlementsContextType | null>(null);
