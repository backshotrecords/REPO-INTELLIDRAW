import { useEffect } from "react";
import { useEntitlements } from "../hooks/useEntitlements";
import PlanBadge from "./PlanBadge";

export default function PlanUsagePanel() {
  const { entitlements, isLoading, refreshEntitlements, getQuotaStatus } = useEntitlements();

  useEffect(() => {
    void refreshEntitlements();
  }, [refreshEntitlements]);

  const plan = entitlements?.plan;
  const quotaFeatures = (entitlements?.features ?? []).filter(
    (feature) => feature.enabled && feature.quota !== null && feature.quota !== undefined,
  );

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
      ) : quotaFeatures.length === 0 ? (
        <p className="text-sm text-on-surface-variant">
          Your {plan?.name || "current"} plan has no usage limits on included features.
        </p>
      ) : (
        <div className="space-y-5">
          {quotaFeatures.map((feature) => {
            const status = getQuotaStatus(feature.key);
            if (!status) return null;
            const low = status.percentRemaining <= 20;
            return (
              <div key={feature.key} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-on-surface">{feature.label}</p>
                  <p className={`text-xs font-bold ${low ? "text-error" : "text-on-surface-variant"}`}>
                    {status.percentRemaining}% remaining
                  </p>
                </div>
                <div
                  className="h-2 rounded-full bg-surface-container-high overflow-hidden"
                  role="progressbar"
                  aria-label={`${feature.label} usage`}
                  aria-valuenow={status.usage}
                  aria-valuemin={0}
                  aria-valuemax={status.quota}
                >
                  <div
                    className={`h-full rounded-full transition-all ${low ? "bg-error" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, status.percentUsed)}%` }}
                  />
                </div>
                <p className="text-xs text-on-surface-variant">
                  {status.usage} of {status.quota} used
                  {status.resetPeriodDays > 0
                    ? ` · resets every ${status.resetPeriodDays} day${status.resetPeriodDays === 1 ? "" : "s"}`
                    : " · lifetime limit"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
