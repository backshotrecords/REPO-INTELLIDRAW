import { useEffect } from "react";
import { useEntitlements } from "../hooks/useEntitlements";
import PlanBadge from "./PlanBadge";
import QuotaMeterList from "./QuotaMeterList";

export default function PlanUsagePanel() {
  const { entitlements, isLoading, refreshEntitlements } = useEntitlements();

  useEffect(() => {
    void refreshEntitlements();
  }, [refreshEntitlements]);

  const plan = entitlements?.plan;

  return (
    <div className="bg-surface-container-low rounded-xl p-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-on-surface-variant">Current plan</p>
          <p className="text-2xl font-headline font-bold text-on-surface">
            {plan?.name || "Free"}
          </p>
        </div>
        <PlanBadge planId={plan?.id} />
      </div>

      {isLoading && !entitlements ? (
        <p className="text-sm text-on-surface-variant">Loading usage...</p>
      ) : (
        <QuotaMeterList />
      )}
    </div>
  );
}
